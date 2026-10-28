import type { BeamCheckConfig } from "../fem/femTypes";
import { dichtheidVanMateriaal, G, resolveSection } from "../../lib/sectionResolver";
import { sampleCircularArc3D, type ArcPoint3D } from "./openFem3dCircularArc";
import type { OpenFem3DSelection } from "./openFem3dSelection";
import { OPEN_FEM_3D_DEFAULT_LAYER, parseOpenFem3DLayers, readOpenFem3DLayerId, type OpenFem3DLayer } from "./openFem3dLayers";
import { resolveOpenFem3DPlateMaterial } from "./openFem3dPlateMaterial";
import {
  OPEN_FEM_3D_LINTEL_DEFAULT, openFem3DLintelEnds, openFem3DWallFrame, readOpenFem3DMasonryWall, readOpenFem3DOpeningLintel,
  type OpenFem3DLintelLoadSpread, type OpenFem3DMasonryWall, type OpenFem3DOpeningLintel,
} from "./openFem3dMetselwerkwand";
import { openFem3DBeamVerloop, openFem3DVerloopDelen } from "./openFem3dVerloop";
import { splitsVerlopendProfiel, tussenProfielVoorSplitsing } from "../../lib/verloopSplitsen";
import { readOpenFem3DAnalysisMaterials, type OpenFem3DAnalysisMaterials } from "./openFem3dAnalysisMaterial";
import type { AfleidingsRegel } from "../../lib/wind/windEurocode";
import { parseWindSurfacePressurePlan, type WindSurfacePressurePlan } from "../../lib/wind/windSurfacePressurePlan";
import {
  attachOpenFem3DNativeFields, isFrame3DEdgeSupportTuple, legacyFrame3DEdgeSupportsToOpenFem3D,
  type OpenFem3DNativeBeamFields, type OpenFem3DNativeModelFields, type OpenFem3DNativePlateFields,
} from "./openFem3dNativeModel";

/** Geometry for the 3D workspace. Coordinates are metres; Z is vertical, like 2D. */
export interface OpenFem3DNode {
  id: number;
  layerId?: number;
  x: number;
  y: number;
  z: number;
  /**
   * Level waaraan de knoop gekoppeld is: het id van een horizontale
   * stramienas (`StructuralGrid.zAxes`). De knoop ligt dan op de hoogte van
   * dat level en schuift mee als die hoogte verandert (zie openFem3dLevels).
   * Ontbreekt in oude bestanden en bij een vrije knoop. Alleen modelinvoer:
   * de rekenkern krijgt het veld niet.
   */
  levelId?: string;
  /** Naam uit een bronmodel (bijvoorbeeld een IFC-analysemodel); alleen voor weergave en rapport. */
  name?: string;
}

/** Native-routevelden (axiale staaf, materiaalwet): zie openFem3dNativeModel. */
export interface OpenFem3DBeam extends OpenFem3DNativeBeamFields {
  id: number;
  layerId?: number;
  startNodeId: number;
  endNodeId: number;
  /** Optional model metadata; the centre-line remains valid without it. */
  profileName?: string;
  /**
   * Verlopende staaf (issue #73): het profiel aan het EINDE (eindknoop); de
   * maten verlopen lineair van `profileName` (beginknoop) naar dit profiel.
   * Dezelfde keuring als een 2D-staaf (`bepaalVerloop`): rechthoek ↔ rechthoek
   * of I/H ↔ I/H uit de staalcatalogus (gerekend als gelast I-profiel).
   * Ontbreekt het veld (alle oudere bestanden), dan is de staaf prismatisch.
   * De rekenkern krijgt de staaf in gelijke delen (`partSectionIds`), zie
   * openFem3dVerloop.
   */
  profileNameEnd?: string;
  material?: string;
  /** Dezelfde materiaal- en norminstellingen als bij een 2D-staaf. */
  checkConfig?: BeamCheckConfig;
  /** Rotatie van de lokale y/z-assen om de staafas, in radialen. */
  rollAngleRad?: number;
  /** Afschuifvervorming (Timoshenko); zonder dit veld blijft Euler–Bernoulli gelden. */
  shearDeformation?: boolean;
  /** Moment- en torsiescharnieren aan de staafeinden, in lokale assen. */
  releases?: OpenFem3DEndReleases;
  /**
   * Trek-alleen staaf, zoals een windverband van rond staal: zij telt alleen
   * mee zolang zij op trek staat. Komt zij in een belastinggeval of combinatie
   * op druk, dan valt zij voor die berekening weg (normaalkracht 0).
   */
  tensionOnly?: boolean;
  /**
   * Staaf op bedding (Winkler, issue #106): de grond steunt de staaf over haar
   * hele lengte met veren k·b per m. Ontbreekt het veld (alle oudere
   * bestanden), dan ligt de staaf niet op een bedding. De rekenkern knipt de
   * staaf zelf fijn genoeg; zie {@link OpenFem3DBeamBedding}.
   */
  bedding?: OpenFem3DBeamBedding;
  /** Naam uit een bronmodel (bijvoorbeeld een IFC-analysemodel); alleen voor weergave en rapport. */
  name?: string;
  /** Onderdeel of groep (kolom, vloerligger, windverband …); alleen voor weergave, selectie en rapport. */
  group?: string;
}

/**
 * Bedding onder (of langs) een 3D-staaf. Dezelfde betekenis als het veld
 * `bedding` van `Member3D` in het rekencontract; lengtes in m zoals de rest
 * van het 3D-model (de app toont en neemt b in mm).
 *  - `kKnPerM3`: beddingsconstante voor de VERTICALE richting (globaal Z, de
 *    grond ligt onder de staaf). Ontbreekt bij een (bijna) verticale staaf:
 *    die kan alleen zijdelings op bedding staan (paal in de grond).
 *  - `widthM`: contactbreedte b; de lijnstijfheid is k·b (kN/m per m).
 *  - `kLateralKnPerM3`: zijdelingse bedding, horizontaal loodrecht op de
 *    staafas naar beide zijden, altijd lineair. Bij een staaf steiler dan 45°
 *    (een (schoor)paal, {@link openFem3DBeddingAllRound}) rondom, in twee
 *    richtingen loodrecht op de as; bij een loodrechte paal in X en Y.
 *  - `compressionOnly`: de verticale veren werken alleen op druk (de grond
 *    trekt niet); alleen `true` wordt bewaard.
 * Minstens één van beide constanten is gegeven ({@link readOpenFem3DBeamBedding}).
 */
export interface OpenFem3DBeamBedding {
  kKnPerM3?: number;
  widthM: number;
  kLateralKnPerM3?: number;
  compressionOnly?: boolean;
}

/**
 * Starre schijf in het horizontale vlak, zoals een kanaalplaatvloer met
 * druklaag: de knopen verplaatsen in X en Y en roteren om Z samen als één
 * star lichaam. De verticale verplaatsing en de rotaties om X en Y blijven per
 * knoop vrij. Alle knopen liggen op dezelfde hoogte.
 */
export interface OpenFem3DDiaphragm {
  id: number;
  /** Knopen die de schijf koppelt, minimaal twee. Een knoop hoort bij hoogstens één schijf. */
  nodeIds: number[];
  /** Naam voor weergave en rapport, bijvoorbeeld "Vloer +3.600". */
  name?: string;
}

export interface OpenFem3DEndReleases {
  myStart: boolean;
  myEnd: boolean;
  mzStart: boolean;
  mzEnd: boolean;
  torsionStart: boolean;
  torsionEnd: boolean;
}

/** True means that this global displacement or rotation is restrained. */
export interface OpenFem3DSupportRestraints {
  ux: boolean;
  uy: boolean;
  uz: boolean;
  rx: boolean;
  ry: boolean;
  rz: boolean;
}

export interface OpenFem3DSupport extends OpenFem3DSupportRestraints {
  nodeId: number;
  layerId?: number;
  /** Globale oplegveren. Translatie in kN/m, rotatie in kNm/rad. */
  springs?: OpenFem3DSupportSprings;
  /** Opgelegde waarden op geblokkeerde globale DOF's; m en rad. */
  prescribed?: OpenFem3DPrescribedDisplacements;
}

export interface OpenFem3DSupportSprings {
  kxKnPerM?: number;
  kyKnPerM?: number;
  kzKnPerM?: number;
  krxKnmPerRad?: number;
  kryKnmPerRad?: number;
  krzKnmPerRad?: number;
}

export interface OpenFem3DPrescribedDisplacements {
  uxM?: number;
  uyM?: number;
  uzM?: number;
  rxRad?: number;
  ryRad?: number;
  rzRad?: number;
}

/** Forces are kN, moments kNm, all in the global X/Y/Z axes. */
export interface OpenFem3DNodalLoadComponents {
  fx: number;
  fy: number;
  fz: number;
  mx: number;
  my: number;
  mz: number;
}

export interface OpenFem3DNodalLoad extends OpenFem3DNodalLoadComponents {
  id: number;
  layerId?: number;
  nodeId: number;
  /** Belastinggeval uit de gedeelde projectlijst. Ontbrekend in oude bestanden = geval 1. */
  caseId?: number;
  /** Generated NBC main-system partial wind transfer; manual loads omit this. */
  generated?: { source: "nbc2025-partial-wind"; key: string; sourceReference: string };
}

/** Een globale as als richting van een lijnlast (issue #80). */
export type OpenFem3DGlobalDirection = "x" | "y" | "z";
export const OPEN_FEM_3D_GLOBAL_DIRECTIONS: readonly OpenFem3DGlobalDirection[] = ["x", "y", "z"];

/** Wat elke lijnlast op een staaf heeft: staaf, geval en het belaste deel in m vanaf de beginknoop. */
interface OpenFem3DMemberLoadBase {
  id: number;
  layerId?: number;
  beamId: number;
  /** Belastinggeval uit de gedeelde projectlijst. Ontbrekend in oude bestanden = geval 1. */
  caseId?: number;
  startPositionM: number;
  endPositionM: number;
}

/** Trapezoidal staafbelasting in lokale y/z-richting; afstanden in m, intensiteiten in kN/m. */
export interface OpenFem3DLocalMemberLoad extends OpenFem3DMemberLoadBase {
  qyStart: number;
  qyEnd: number;
  qzStart: number;
  qzEnd: number;
  globalDirection?: undefined;
  qStart?: undefined;
  qEnd?: undefined;
  perProjection?: undefined;
}

/**
 * Lijnlast in een globale richting (issue #80): q met teken langs de globale
 * as (Z negatief = omlaag), lineair van `qStart` naar `qEnd` over het belaste
 * deel, in kN/m. Per meter staaflengte, of met `perProjection` per meter
 * projectie van de staaf op het vlak loodrecht op de lastrichting (sneeuw op
 * een schuine spant: Z-last per horizontale meter; per staafmeter is dat
 * q·|e_x × d|). De kern zet de last om naar de staaf; de app rekent niets om.
 */
export interface OpenFem3DGlobalMemberLoad extends OpenFem3DMemberLoadBase {
  globalDirection: OpenFem3DGlobalDirection;
  qStart: number;
  qEnd: number;
  /** Alleen `true` wordt bewaard; ontbreekt = per meter staaflengte. */
  perProjection?: boolean;
  qyStart?: undefined;
  qyEnd?: undefined;
  qzStart?: undefined;
  qzEnd?: undefined;
}

/** Een lijnlast op een staaf: lokaal (qy/qz) of, met `globalDirection`, globaal. */
export type OpenFem3DMemberLoad = OpenFem3DLocalMemberLoad | OpenFem3DGlobalMemberLoad;

/** De waarden van een lijnlast zonder id, staaf en geval (toevoegen en wijzigen). */
export type OpenFem3DMemberLoadValues =
  | Omit<OpenFem3DLocalMemberLoad, "id" | "beamId" | "caseId">
  | Omit<OpenFem3DGlobalMemberLoad, "id" | "beamId" | "caseId">;

/** Is dit een globale lijnlast (model of rekenverzoek)? */
export function isOpenFem3DGlobalMemberLoad<T extends { globalDirection?: OpenFem3DGlobalDirection }>(
  load: T,
): load is T & { globalDirection: OpenFem3DGlobalDirection } {
  return load.globalDirection !== undefined;
}

/** De eenheidsvector van een globale as. */
export function openFem3DGlobalDirectionVector(direction: OpenFem3DGlobalDirection): Vector3 {
  return direction === "x" ? [1, 0, 0] : direction === "y" ? [0, 1, 0] : [0, 0, 1];
}

/** Boven deze |d·e_x| ligt een globale lijnlast (bijna) langs haar staaf. */
export const OPEN_FEM_3D_LOAD_ALONG_MEMBER = 0.95;

/**
 * Ligt deze lijnlast (bijna) langs haar staaf, met e_x de staafas? Alleen een
 * globale last kan dat: een kolom onder Globaal Z, een ligger langs X onder
 * Globaal X. Getekend vallen haar pijlen dan op de staafas; het tekenvlak en
 * het rapportbeeld zetten ze daarom naast de staaf.
 */
export function openFem3DMemberLoadAlongMember(load: OpenFem3DMemberLoad, ex: readonly number[]): boolean {
  if (!isOpenFem3DGlobalMemberLoad(load)) return false;
  const d = openFem3DGlobalDirectionVector(load.globalDirection);
  return Math.abs(d[0] * ex[0] + d[1] * ex[1] + d[2] * ex[2]) > OPEN_FEM_3D_LOAD_ALONG_MEMBER;
}

/**
 * De factor van een globale lijnlast naar kN per meter staaflengte: 1 per
 * staafmeter, en per projectie |e_x × d|, de lengte van de projectie van één
 * staafmeter op het vlak loodrecht op de lastrichting d (cos α voor een
 * Z-last op een spant onder helling α). Alleen voor de onafhankelijke
 * krachtensom en de scheefstand; de staaf zelf belast de kern.
 */
export function openFem3DGlobalMemberLoadFactor(
  ex: readonly number[], direction: OpenFem3DGlobalDirection, perProjection: boolean | undefined,
): number {
  if (!perProjection) return 1;
  const d = openFem3DGlobalDirectionVector(direction);
  return Math.hypot(ex[1] * d[2] - ex[2] * d[1], ex[2] * d[0] - ex[0] * d[2], ex[0] * d[1] - ex[1] * d[0]);
}

/** Puntlast op een staaf in lokale y/z-richting; positie in m en krachten in kN. */
export interface OpenFem3DMemberPointLoad {
  id: number;
  layerId?: number;
  beamId: number;
  /** Belastinggeval uit de gedeelde projectlijst. Ontbrekend in oude bestanden = geval 1. */
  caseId?: number;
  py: number;
  pz: number;
  positionM: number;
}

/** Temperatuurbelasting op een staaf; alle waarden zijn temperatuurverschillen in K. */
export interface OpenFem3DThermalLoad {
  id: number;
  layerId?: number;
  beamId: number;
  caseId?: number;
  deltaTUniformK: number;
  /** Verschil over de doorsnede in lokale y-richting; veroorzaakt Mz. */
  deltaTGradientYK: number;
  /** Verschil over de doorsnede in lokale z-richting; veroorzaakt My. */
  deltaTGradientZK: number;
}

export interface OpenFem3DPlateOpening {
  id: number;
  /** Knoopvolgorde rond de opening; dezelfde vlakke basis als de plaat. */
  nodeIds: number[];
  /** Getekende gesloten contour. Een boog gebruikt begin-, stuur- en eindknoop. */
  boundary?: OpenFem3DPlateBoundarySegment[];
  cornerRadiusM?: number;
  /**
   * Latei boven deze opening (metselwerkwand, issue #97): een gewone staaf
   * van het model, plus opleglengte en lastspreiding voor de lateitoets.
   * Zie openFem3dMetselwerkwand.
   */
  lintel?: OpenFem3DOpeningLintel;
}

export type OpenFem3DPlateBoundarySegment =
  | { kind: "line"; startNodeId: number; endNodeId: number }
  | { kind: "arc"; startNodeId: number; controlNodeId: number; endNodeId: number };

/** Native-routevelden (membraan, wapening, materiaalwet): zie openFem3dNativeModel. */
export interface OpenFem3DPlate extends OpenFem3DNativePlateFields {
  id: number;
  layerId?: number;
  /** Knoopvolgorde rond de buitenrand, minimaal drie. */
  nodeIds: number[];
  /** Werkelijke getekende rand; ontbreekt bij oudere hoekpuntplaten. */
  boundary?: OpenFem3DPlateBoundarySegment[];
  thicknessM: number;
  material?: string;
  /** Werkelijke afrondingsstraal van de plaatrand. */
  cornerRadiusM?: number;
  openings?: OpenFem3DPlateOpening[];
  /**
   * Level waarop de plaat horizontaal ligt (id van een `StructuralGrid.zAxes`).
   * Dan draagt elke knoop van de plaat, ook die van de openingen, hetzelfde
   * `levelId`; `parseOpenFem3DModel` laat een koppeling die daar niet aan
   * voldoet vallen.
   */
  levelId?: string;
  /**
   * Elementgrootte van het rekennet in m. Ontbreekt: automatisch, een tiende
   * van de kleinste plaatmaat, begrensd tussen 0,1 en 0,5 m.
   */
  meshSizeM?: number;
  /** Lijnopleggingen langs randen van de buitencontour. */
  edgeSupports?: OpenFem3DPlateEdgeSupport[];
  /**
   * Plaat op bedding (Winkler, issue #107): de grond steunt de plaat over haar
   * hele oppervlak, loodrecht op het plaatvlak. Ontbreekt het veld (ook in
   * oude bestanden), dan ligt de plaat niet op een bedding. De rekenkern zet
   * de grondveren zelf op de knopen van het rekennet; zie
   * {@link OpenFem3DPlateBedding}.
   */
  bedding?: OpenFem3DPlateBedding;
  /**
   * Metselwerkwand (issue #97): de plaat rekent orthotroop (E verticaal =
   * E metselwerk, E horizontaal ≈ 0, G = 0,4·E) en haar eigen gewicht is
   * γ·t. `material` doet dan niet mee. Zie openFem3dMetselwerkwand.
   */
  masonry?: OpenFem3DMasonryWall;
}

/**
 * Bedding onder een 3D-plaat (issue #107). Dezelfde betekenis als het veld
 * `bedding` van `Plate3D` in het rekencontract:
 *  - `kKnPerM3`: beddingsconstante k (kN/m³), loodrecht op het plaatvlak. De
 *    grond ligt aan de onderzijde van de plaat: tegen de plaatnormaal in (de
 *    z-as van de plaatassen; bij een vloer globaal −Z, zie
 *    `openFem3DPlateGroundDirection`);
 *  - `compressionOnly`: alleen druk; waar de plaat van de grond loskomt,
 *    vallen de veren weg. Alleen `true` wordt bewaard.
 * Gekeurd met {@link readOpenFem3DPlateBedding}.
 */
export interface OpenFem3DPlateBedding {
  kKnPerM3: number;
  compressionOnly?: boolean;
}

/**
 * Oplegging langs één rand van de buitencontour van een plaat. Blokkeert de
 * gekozen globale verplaatsingen en rotaties in álle rekenknopen op die rand.
 */
export interface OpenFem3DPlateEdgeSupport extends OpenFem3DSupportRestraints {
  /**
   * Rand k: het randstuk k van `boundary`, of zonder getekende contour de
   * rand van contourknoop k naar k+1 (cyclisch).
   */
  edge: number;
}

/** Oppervlaktebelasting in globale assen, kN/m². */
export interface OpenFem3DSurfaceLoad {
  id: number;
  layerId?: number;
  plateId: number;
  caseId?: number;
  qx: number;
  qy: number;
  qz: number;
}

/**
 * Lastrichting van een belastingvlak:
 *  - "gravity": q werkt in globale −Z, per m² HORIZONTALE PROJECTIE (sneeuw,
 *    vloer, dakafwerking). Σ verticaal = q × projectie-oppervlak.
 *  - "normal": q werkt loodrecht op het vlak, per m² VLAK (wind). Positief in
 *    de richting van de vaste vlaknormaal (zie `openFem3dLoadPanels.ts`).
 *  - "verticalSurface": q werkt in globale −Z per m² WERKELIJK vlak
 *    (eigen gewicht van gevel- of dakbekleding).
 */
export type OpenFem3DLoadPanelDirection = "gravity" | "normal" | "verticalSurface";
/**
 * Afdracht naar de liggers in het vlak:
 *  - "oneWay": naar de liggers dwars op de overspanningsrichting, elk met de
 *    halve afstand tot de buren als belastingbreedte.
 *  - "twoWay": naar alle liggers in het vlak volgens de 45°-lijnen (driehoek
 *    en trapezium); algemeen: elk punt naar de dichtstbijzijnde ligger.
 */
export type OpenFem3DLoadPanelDistribution = "oneWay" | "twoWay";

export interface OpenFem3DVector {
  x: number;
  y: number;
  z: number;
}

/**
 * Belastingvlak: een vlakke veelhoek over bestaande knopen die geen
 * stijfheid heeft en alleen zijn oppervlaktelast afdraagt naar de liggers in
 * het vlak. De omzetting naar staaflasten gebeurt in TypeScript vóór de
 * rekenkern (`openFem3dLoadPanels.ts`); de kern zelf kent geen vlakken.
 */
export interface OpenFem3DLoadPanel {
  id: number;
  layerId?: number;
  /** Herkomst van een gegenereerde gebouwschillast; ontbreekt bij handmatige vlakken. */
  generated?: {
    source: "envelope3d";
    /** Stabiel over opnieuw genereren, ook wanneer id's veranderen. */
    key: string;
    panelId: number;
    zone: string;
    /** c_pe of μ; bij bekleding 1. */
    coefficient: number;
    /** q_p of C_e C_t s_k in kN/m²; bij bekleding de invoerwaarde. */
    referencePressureKnPerM2: number;
    /** c_pi bij wind; ontbreekt bij sneeuw en bekleding. */
    internalPressureCoefficient?: number;
    /** Herkomst van c_pi; ontbreekt in oudere projectbestanden. */
    windInternalPressureDerivation?: AfleidingsRegel[];
    /** Normroute waarmee dit wind- of sneeuwvlak is gegenereerd. */
    windCodeId?: string;
    /** Toegepaste constructiefactor c_s·c_d. Ontbreekt bij oudere windvlakken. */
    windStructuralFactor?: number;
    /** Gebruikte referentiehoogte en bewaarde afleiding van de winddruk. Ontbreken in oudere bestanden. */
    windReferenceHeightM?: number;
    windPressureDerivation?: AfleidingsRegel[];
    /** EN-terreinprofiel of handmatig opgegeven druk; ontbreekt in oudere windvlakken. */
    windPressureMethod?: "en-terreinprofiel" | "handmatig-opgegeven" | "nbc-static";
    /** Separate external/internal pressure balance, retained with NBC load panels. */
    windPressurePlan?: WindSurfacePressurePlan;
    sourceReference: string;
  };
  /** Hoekknopen rond de omtrek, minimaal drie en in één vlak. */
  nodeIds: number[];
  /** Belastinggeval uit de gedeelde projectlijst. Ontbrekend = geval 1. */
  caseId?: number;
  /** Intensiteit in kN/m² (per horizontale projectie of per vlak, zie `direction`). */
  q: number;
  direction: OpenFem3DLoadPanelDirection;
  distribution: OpenFem3DLoadPanelDistribution;
  /** Globale overspanningsrichting; wordt op het vlak geprojecteerd. Verplicht bij éénrichting. */
  spanDirection?: OpenFem3DVector;
  /** Staven in het vlak die bewust géén last krijgen (bijvoorbeeld windverbanden). */
  excludedBeamIds?: number[];
  /** Uitsparingen zonder oppervlaktebelasting; de afdracht rekent met het netto vlak. */
  openings?: { id: number; nodeIds: number[] }[];
}

/** Gevel- of dakvlak van de gebouwschil, onafhankelijk van belastinggevallen. */
export interface OpenFem3DEnvelopePanel {
  id: number;
  layerId?: number;
  nodeIds: number[];
  type: "facade" | "roof";
  /** Keert de buitenwaartse normaal om ten opzichte van de knoopvolgorde. */
  flipOuterSide?: boolean;
  distribution: OpenFem3DLoadPanelDistribution;
  spanDirection?: OpenFem3DVector;
  /** Openingen in dezelfde vlakke geometrie als de buitencontour. */
  openings?: { id: number; nodeIds: number[] }[];
  /** Eigen gewicht van de bekleding per werkelijk vlakoppervlak, kN/m². */
  claddingWeightKnPerM2?: number;
  name?: string;
}

/**
 * Native-routevelden (volumes Tet4/Hex8, volumelasten, plaatrandlasten,
 * FNL-lastpad): zie openFem3dNativeModel. Alleen Open FEM Rust rekent ze.
 */
export interface OpenFem3DModel extends OpenFem3DNativeModelFields {
  nodes: OpenFem3DNode[];
  beams: OpenFem3DBeam[];
  /** Optional so older project files keep their exact geometry and semantics. */
  layers?: OpenFem3DLayer[];
  /** Analyse-E en ν per materiaalnaam; de normtoets blijft de oorspronkelijke klasse gebruiken. */
  analysisMaterials?: OpenFem3DAnalysisMaterials;
  /** Optional so models made before nodal conditions remain readable. */
  supports?: OpenFem3DSupport[];
  loads?: OpenFem3DNodalLoad[];
  memberLoads?: OpenFem3DMemberLoad[];
  memberPointLoads?: OpenFem3DMemberPointLoad[];
  thermalLoads?: OpenFem3DThermalLoad[];
  plates?: OpenFem3DPlate[];
  surfaceLoads?: OpenFem3DSurfaceLoad[];
  /** Ontbreekt in bestanden van vóór de belastingvlakken. */
  loadPanels?: OpenFem3DLoadPanel[];
  /** Gebouwschil zonder stijfheid; geen handmatige belasting per geval. */
  envelopePanels?: OpenFem3DEnvelopePanel[];
  /** Hulpknopen van de 3D-belastinggenerator; alleen ongebruikte hulpknopen mogen bij regeneratie weg. */
  generatedNodeIds?: number[];
  /** Starre horizontale schijven; ontbreekt in bestanden van vóór de schijven. */
  diaphragms?: OpenFem3DDiaphragm[];
  /**
   * Trek-alleen staven gemonteerd na de permanente belasting: hun
   * spanningsloze lengte volgt de koorde onder de blijvende belastinggevallen
   * (type "dead", factor 1,0, met eigen gewicht en belastingvlakken). Alleen
   * `true` wordt bewaard; ontbreekt het, dan zijn ze spanningsloos in de
   * onvervormde stand.
   */
  tensionOnlyFitAfterPermanent?: boolean;
  /**
   * Kruisregel: van twee trek-alleen staven die elkaar kruisen, blijft altijd
   * de staaf met de grootste normaalkracht actief. Alleen `true` wordt bewaard.
   */
  tensionOnlyCrossRule?: boolean;
}

export const EMPTY_OPEN_FEM_3D: OpenFem3DModel = {
  nodes: [], beams: [], supports: [], loads: [], memberLoads: [], memberPointLoads: [], thermalLoads: [], plates: [], surfaceLoads: [],
  loadPanels: [],
  envelopePanels: [],
};

function nextEntityId(items: readonly { id: number }[]): number {
  let maximum = 0;
  for (const item of items) if (item.id > maximum) maximum = item.id;
  return maximum + 1;
}

export const OPEN_FEM_3D_SUPPORT_PRESETS = {
  fixed: { ux: true, uy: true, uz: true, rx: true, ry: true, rz: true },
  pinned: { ux: true, uy: true, uz: true, rx: false, ry: false, rz: false },
  /** Ruimtelijke rolpresets blokkeren precies de genoemde globale translatie. */
  xRoller: { ux: true, uy: false, uz: false, rx: false, ry: false, rz: false },
  yRoller: { ux: false, uy: true, uz: false, rx: false, ry: false, rz: false },
  zRoller: { ux: false, uy: false, uz: true, rx: false, ry: false, rz: false },
  /** Translatievast; alleen rotatie om de gekozen globale as blijft vrij. */
  revoluteX: { ux: true, uy: true, uz: true, rx: false, ry: true, rz: true },
  revoluteY: { ux: true, uy: true, uz: true, rx: true, ry: false, rz: true },
  revoluteZ: { ux: true, uy: true, uz: true, rx: true, ry: true, rz: false },
} as const satisfies Record<string, OpenFem3DSupportRestraints>;

export type OpenFem3DSupportPreset = keyof typeof OPEN_FEM_3D_SUPPORT_PRESETS;

/** Herken een standaardoplegging zonder een tweede, potentieel strijdige typecode op te slaan. */
export function openFem3DSupportPresetOf(
  support: OpenFem3DSupportRestraints,
): OpenFem3DSupportPreset | "custom" {
  const axes = ["ux", "uy", "uz", "rx", "ry", "rz"] as const;
  for (const [name, preset] of Object.entries(OPEN_FEM_3D_SUPPORT_PRESETS)) {
    if (axes.every((axis) => support[axis] === preset[axis])) return name as OpenFem3DSupportPreset;
  }
  return "custom";
}

export function openFem3DRevoluteAxis(
  support: OpenFem3DSupportRestraints,
): "x" | "y" | "z" | null {
  const preset = openFem3DSupportPresetOf(support);
  return preset === "revoluteX" ? "x" : preset === "revoluteY" ? "y" : preset === "revoluteZ" ? "z" : null;
}

const SUPPORT_DOF = ["ux", "uy", "uz", "rx", "ry", "rz"] as const;
const SPRING_DOF = ["kxKnPerM", "kyKnPerM", "kzKnPerM", "krxKnmPerRad", "kryKnmPerRad", "krzKnmPerRad"] as const;
const PRESCRIBED_DOF = ["uxM", "uyM", "uzM", "rxRad", "ryRad", "rzRad"] as const;
const LOAD_DOF = ["fx", "fy", "fz", "mx", "my", "mz"] as const;
const RELEASE_DOF = ["myStart", "myEnd", "mzStart", "mzEnd", "torsionStart", "torsionEnd"] as const;

function readEndReleases(value: unknown): OpenFem3DEndReleases | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Een 3D-staaf bevat ongeldige eindscharnieren.");
  }
  const releases = value as Record<string, unknown>;
  if (RELEASE_DOF.some((axis) => releases[axis] !== undefined && typeof releases[axis] !== "boolean")) {
    throw new Error("Een 3D-staaf bevat een ongeldig eindscharnier.");
  }
  return Object.fromEntries(RELEASE_DOF.map((axis) => [axis, releases[axis] === true])) as unknown as OpenFem3DEndReleases;
}

type Vector3 = [number, number, number];

/** Dezelfde Z-up lokale assen als de solver, inclusief profielrotatie. */
export function openFem3DMemberAxes(
  start: Pick<OpenFem3DNode, "x" | "y" | "z">,
  end: Pick<OpenFem3DNode, "x" | "y" | "z">,
  rollAngleRad = 0,
): { ex: Vector3; ey: Vector3; ez: Vector3 } {
  const length = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
  if (!(length > 0) || !Number.isFinite(rollAngleRad)) throw new Error("Een 3D-staaf heeft ongeldige lokale assen.");
  const ex: Vector3 = [(end.x - start.x) / length, (end.y - start.y) / length, (end.z - start.z) / length];
  const up: Vector3 = Math.abs(ex[2]) > 0.999 ? [1, 0, 0] : [0, 0, 1];
  const projection = ex[0] * up[0] + ex[1] * up[1] + ex[2] * up[2];
  const ezBase: Vector3 = [
    up[0] - projection * ex[0], up[1] - projection * ex[1], up[2] - projection * ex[2],
  ];
  const ezLength = Math.hypot(...ezBase);
  const ez0: Vector3 = [ezBase[0] / ezLength, ezBase[1] / ezLength, ezBase[2] / ezLength];
  const ey0: Vector3 = [
    ez0[1] * ex[2] - ez0[2] * ex[1],
    ez0[2] * ex[0] - ez0[0] * ex[2],
    ez0[0] * ex[1] - ez0[1] * ex[0],
  ];
  const cosine = Math.cos(rollAngleRad), sine = Math.sin(rollAngleRad);
  const ey: Vector3 = [
    cosine * ey0[0] + sine * ez0[0],
    cosine * ey0[1] + sine * ez0[1],
    cosine * ey0[2] + sine * ez0[2],
  ];
  const ez: Vector3 = [
    cosine * ez0[0] - sine * ey0[0],
    cosine * ez0[1] - sine * ey0[1],
    cosine * ez0[2] - sine * ey0[2],
  ];
  return { ex, ey, ez };
}

/** Levelverwijzing (id van een horizontale stramienas); leeg of null = geen. */
function readOptionalLevelId(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error(`${label} heeft een ongeldige levelverwijzing.`);
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function readOptionalCaseId(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new Error("Een 3D-belasting heeft een ongeldig belastinggeval.");
  }
  return Number(value);
}

export function openFem3DLoadCaseId(load: { caseId?: number }): number {
  return load.caseId ?? 1;
}

/**
 * Voeg het automatische eigen gewicht toe aan een vluchtige kopie van het
 * 3D-model. Het gewicht werkt altijd in globale -Z, als globale lijnlast in Z
 * per deel van de staaf (#112). De kern ontbindt die zelf in de lokale assen
 * en verdeelt ook de axiale component over de staaf, met de correctie van de
 * N-lijn (#80, `globale_lasten.rs`): in een kolom loopt N van 0 aan de top
 * naar het eigen gewicht aan de voet. Tot oktober 2026 ging de axiale
 * component als knooplasten naar de staafeinden; de reacties klopten, de
 * N-lijn week tot het halve kolomgewicht af. Een plaat krijgt een vlaklast
 * −ρ·g·t in Z (kN/m²) over haar hele oppervlak.
 *
 * Een trek-alleen staaf (strip, staaf) hangt in werkelijkheid door en draagt
 * haar gewicht als kabel naar haar einden; scharnierend gemodelleerd zou zij
 * onder dat gewicht buigen. Haar gewicht ρ·A·g·L gaat daarom als twee gelijke
 * knooplasten in −Z naar begin- en eindknoop (kabelwerking): dezelfde
 * resultante, geen buigend moment in de staaf.
 */
export function withOpenFem3DSelfWeight(model: OpenFem3DModel, caseId: number): OpenFem3DModel {
  if (!Number.isSafeInteger(caseId) || caseId <= 0) throw new Error("Het belastinggeval voor 3D-eigen gewicht is ongeldig.");
  const loads = [...(model.loads ?? [])];
  const memberLoads = [...(model.memberLoads ?? [])];
  let nextLoadId = nextEntityId(loads);
  let nextMemberLoadId = nextEntityId(memberLoads);

  for (const beam of model.beams) {
    const start = model.nodes.find((node) => node.id === beam.startNodeId)!;
    const end = model.nodes.find((node) => node.id === beam.endNodeId)!;
    const length = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);

    const resolved = resolveSection(beam.material?.trim() ?? "", beam.profileName?.trim() ?? "");
    if (resolved.bron === "default") {
      throw new Error(`Staaf ${beam.id}: eigen gewicht kan niet worden bepaald: ${resolved.reden ?? "doorsnede onbekend"}.`);
    }
    // Verlopende staaf (#73): per gelijk deel de A van zijn midden, op
    // dezelfde deelgrenzen als de kern (zoals `eigenGewichtLasten` in 2D);
    // prismatisch één deel met de volle doorsnede.
    const indeling = openFem3DVerloopDelen(beam, length);
    const delen = indeling
      ? indeling.delen.map((deel) => ({ tStart: deel.tStart, tEnd: deel.tEnd, areaMm2: deel.doorsnede.areaMm2 }))
      : [{ tStart: 0, tEnd: 1, areaMm2: resolved.aBruto ?? resolved.A }];
    const rho = dichtheidVanMateriaal(beam.material);
    // Dezelfde volgorde van rekenen als voorheen (A eerst naar m²), zodat een
    // prismatische staaf bit voor bit hetzelfde eigen gewicht houdt.
    const qVan = (areaMm2: number) => -(rho * (areaMm2 * 1e-6) * G) / 1000;
    if (beam.tensionOnly) {
      // Kabelwerking: het halve gewicht op elk einde, in −Z.
      const endForce = delen.reduce((som, deel) => som + qVan(deel.areaMm2) * (deel.tEnd - deel.tStart) * length, 0) / 2;
      if (endForce !== 0) {
        for (const nodeId of [beam.startNodeId, beam.endNodeId]) {
          loads.push({ id: nextLoadId++, nodeId, caseId, fx: 0, fy: 0, fz: endForce, mx: 0, my: 0, mz: 0 });
        }
      }
      continue;
    }
    // Per deel een globale lijnlast in Z per staafmeter: de kern ontbindt
    // haar, ook de axiale component (zie de kop).
    for (const deel of delen) {
      const q = qVan(deel.areaMm2);
      if (q === 0) continue;
      memberLoads.push({
        id: nextMemberLoadId++, beamId: beam.id, caseId, globalDirection: "z", qStart: q, qEnd: q,
        startPositionM: deel.tStart * length, endPositionM: deel.tEnd * length,
      });
    }
  }
  const surfaceLoads = [...(model.surfaceLoads ?? [])];
  let nextSurfaceLoadId = nextEntityId(surfaceLoads);
  for (const plate of model.plates ?? []) {
    const material = resolveOpenFem3DPlateMaterial(plate);
    const qz = -(material.rhoKgM3 * G * plate.thicknessM) / 1000;
    if (qz !== 0) surfaceLoads.push({ id: nextSurfaceLoadId++, plateId: plate.id, caseId, qx: 0, qy: 0, qz });
  }
  return { ...model, loads, memberLoads, ...(model.plates?.length ? { surfaceLoads } : {}) };
}

function readSupportRestraints(value: Record<string, unknown>): OpenFem3DSupportRestraints {
  if (SUPPORT_DOF.some((axis) => typeof value[axis] !== "boolean")) {
    throw new Error("Een 3D-oplegging moet zes geldige vrijheidsgraden hebben.");
  }
  return Object.fromEntries(SUPPORT_DOF.map((axis) => [axis, value[axis]])) as unknown as OpenFem3DSupportRestraints;
}

function readSupportSprings(value: unknown): OpenFem3DSupportSprings | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Een 3D-oplegging bevat ongeldige veerstijfheden.");
  }
  const raw = value as Record<string, unknown>;
  const springs: OpenFem3DSupportSprings = {};
  for (const key of SPRING_DOF) {
    const stiffness = raw[key];
    if (stiffness === undefined) continue;
    if (typeof stiffness !== "number" || !Number.isFinite(stiffness) || stiffness <= 0) {
      throw new Error(`Een 3D-oplegging bevat een ongeldige positieve veerstijfheid ${key}.`);
    }
    springs[key] = stiffness;
  }
  return Object.keys(springs).length > 0 ? springs : undefined;
}

function readPrescribedDisplacements(value: unknown): OpenFem3DPrescribedDisplacements | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Een 3D-oplegging bevat ongeldige opgelegde verplaatsingen.");
  }
  const raw = value as Record<string, unknown>;
  const prescribed: OpenFem3DPrescribedDisplacements = {};
  for (const key of PRESCRIBED_DOF) {
    const displacement = raw[key];
    if (displacement === undefined) continue;
    if (typeof displacement !== "number" || !Number.isFinite(displacement)) {
      throw new Error(`Een 3D-oplegging bevat een ongeldige opgelegde waarde ${key}.`);
    }
    if (displacement !== 0) prescribed[key] = displacement;
  }
  return Object.keys(prescribed).length > 0 ? prescribed : undefined;
}

function readNodalLoadComponents(value: Record<string, unknown>): OpenFem3DNodalLoadComponents {
  if (LOAD_DOF.some((axis) => typeof value[axis] !== "number" || !Number.isFinite(value[axis])) ||
      !LOAD_DOF.some((axis) => value[axis] !== 0)) {
    throw new Error("Een 3D-knoopbelasting moet zes eindige componenten en minstens één niet-nulwaarde hebben.");
  }
  return Object.fromEntries(LOAD_DOF.map((axis) => [axis, value[axis]])) as unknown as OpenFem3DNodalLoadComponents;
}

function requireNode(model: OpenFem3DModel, nodeId: number) {
  if (!model.nodes.some((node) => node.id === nodeId)) {
    throw new Error(`3D-knoop ${nodeId} bestaat niet.`);
  }
}

function beamLength(model: OpenFem3DModel, beamId: number): number {
  const beam = model.beams.find((item) => item.id === beamId);
  if (!beam) throw new Error(`3D-staaf ${beamId} bestaat niet.`);
  const start = model.nodes.find((node) => node.id === beam.startNodeId)!;
  const end = model.nodes.find((node) => node.id === beam.endNodeId)!;
  return Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
}

const LOCAL_MEMBER_LOAD_COMPONENTS = ["qyStart", "qyEnd", "qzStart", "qzEnd"] as const;

/** Het belaste deel van een lijnlast, binnen de staaf. */
function readMemberLoadRange(value: Record<string, unknown>, model: OpenFem3DModel, beamId: number) {
  const length = beamLength(model, beamId);
  const startPositionM = Number(value.startPositionM);
  const endPositionM = Number(value.endPositionM);
  if (!Number.isFinite(startPositionM) || !Number.isFinite(endPositionM) ||
      startPositionM < 0 || endPositionM <= startPositionM || endPositionM > length + 1e-9) {
    throw new Error(`Een 3D-staafbelasting moet binnen de staaflengte van ${length} m liggen.`);
  }
  return { startPositionM, endPositionM };
}

/**
 * Een globale lijnlast (issue #80): een bekende richting, eindige qStart en
 * qEnd met minstens één niet-nulwaarde, en geen lokale waarden (0 mag, zoals
 * in het rekencontract, en valt weg). perProjection is ja/nee; alleen `true`
 * wordt bewaard.
 */
function readGlobalMemberLoad(
  value: Record<string, unknown>, model: OpenFem3DModel, id: number, beamId: number,
): OpenFem3DGlobalMemberLoad {
  const globalDirection = value.globalDirection;
  if (!(OPEN_FEM_3D_GLOBAL_DIRECTIONS as readonly unknown[]).includes(globalDirection)) {
    throw new Error(`Een 3D-staafbelasting heeft een ongeldige globale richting ${JSON.stringify(globalDirection)}; kies x, y of z.`);
  }
  if (LOCAL_MEMBER_LOAD_COMPONENTS.some((name) => value[name] !== undefined && value[name] !== 0)) {
    throw new Error("Een globale 3D-staafbelasting heeft geen lokale waarden (qy, qz); geef qStart en qEnd langs de globale as.");
  }
  const { qStart, qEnd } = value;
  if (typeof qStart !== "number" || typeof qEnd !== "number" || !Number.isFinite(qStart) || !Number.isFinite(qEnd) ||
      (qStart === 0 && qEnd === 0)) {
    throw new Error("Een globale 3D-staafbelasting moet een eindige qStart en qEnd en minstens één niet-nulwaarde hebben.");
  }
  if (value.perProjection !== undefined && typeof value.perProjection !== "boolean") {
    throw new Error("perProjection van een globale 3D-staafbelasting is ja of nee (true/false).");
  }
  const { startPositionM, endPositionM } = readMemberLoadRange(value, model, beamId);
  const caseId = readOptionalCaseId(value.caseId);
  return {
    id, beamId, ...(caseId !== undefined ? { caseId } : {}),
    globalDirection: globalDirection as OpenFem3DGlobalDirection, qStart, qEnd,
    ...(value.perProjection === true ? { perProjection: true } : {}),
    startPositionM, endPositionM,
  };
}

function readMemberLoad(
  value: Record<string, unknown>, model: OpenFem3DModel, id: number, beamId: number,
): OpenFem3DMemberLoad {
  if (value.globalDirection !== undefined) return readGlobalMemberLoad(value, model, id, beamId);
  if (value.qStart !== undefined || value.qEnd !== undefined || value.perProjection !== undefined) {
    throw new Error("qStart, qEnd en perProjection horen bij een globale 3D-staafbelasting; geef ook globalDirection (x, y of z).");
  }
  const components = LOCAL_MEMBER_LOAD_COMPONENTS;
  if (components.some((name) => typeof value[name] !== "number" || !Number.isFinite(value[name])) ||
      components.every((name) => value[name] === 0)) {
    throw new Error("Een 3D-staafbelasting moet vier eindige componenten en minstens één niet-nulwaarde hebben.");
  }
  const { startPositionM, endPositionM } = readMemberLoadRange(value, model, beamId);
  const caseId = readOptionalCaseId(value.caseId);
  return {
    id, beamId, ...(caseId !== undefined ? { caseId } : {}),
    qyStart: Number(value.qyStart), qyEnd: Number(value.qyEnd),
    qzStart: Number(value.qzStart), qzEnd: Number(value.qzEnd),
    startPositionM, endPositionM,
  };
}

function readMemberPointLoad(
  value: Record<string, unknown>, model: OpenFem3DModel, id: number, beamId: number,
): OpenFem3DMemberPointLoad {
  const py = Number(value.py), pz = Number(value.pz), positionM = Number(value.positionM);
  if (![py, pz].every(Number.isFinite) || (py === 0 && pz === 0)) {
    throw new Error("Een 3D-staafpuntlast moet twee eindige componenten en minstens één niet-nulwaarde hebben.");
  }
  const length = beamLength(model, beamId);
  if (!Number.isFinite(positionM) || positionM < 0 || positionM > length + 1e-9) {
    throw new Error(`Een 3D-staafpuntlast moet binnen de staaflengte van ${length} m liggen.`);
  }
  const caseId = readOptionalCaseId(value.caseId);
  return { id, beamId, ...(caseId !== undefined ? { caseId } : {}), py, pz, positionM };
}

function readThermalLoad(
  value: Record<string, unknown>, model: OpenFem3DModel, id: number, beamId: number,
): OpenFem3DThermalLoad {
  beamLength(model, beamId);
  const deltaTUniformK = Number(value.deltaTUniformK);
  const deltaTGradientYK = Number(value.deltaTGradientYK ?? 0);
  const deltaTGradientZK = Number(value.deltaTGradientZK ?? 0);
  if (![deltaTUniformK, deltaTGradientYK, deltaTGradientZK].every(Number.isFinite) ||
      [deltaTUniformK, deltaTGradientYK, deltaTGradientZK].every((component) => component === 0)) {
    throw new Error("Een 3D-temperatuurbelasting moet eindige waarden en minstens één niet-nulwaarde hebben.");
  }
  const caseId = readOptionalCaseId(value.caseId);
  return { id, beamId, ...(caseId !== undefined ? { caseId } : {}), deltaTUniformK, deltaTGradientYK, deltaTGradientZK };
}

function readPlateNodeLoop(value: unknown, nodeIds: Set<number>, label: string): number[] {
  if (!Array.isArray(value) || value.length < 3) throw new Error(`${label} moet minstens drie hoekknopen hebben.`);
  const result = value.map(Number);
  if (result.some((id, index) => !Number.isSafeInteger(id) || !nodeIds.has(id) || result.indexOf(id) !== index)) {
    throw new Error(`${label} bevat een ongeldige, ontbrekende of dubbele knoop.`);
  }
  return result;
}

/** Older copies kept the source plate's drawn contour while remapping its node loop. */
function repairCopiedBoundary(
  value: unknown, loop: number[], templates: Map<string, number[]>, nodes: ReadonlyMap<number, OpenFem3DNode>,
): unknown {
  if (!Array.isArray(value) || !value.length) return value;
  const segmentIds = value.flatMap((segment: unknown) => {
    if (!segment || typeof segment !== "object" || Array.isArray(segment)) return [];
    const part = segment as Record<string, unknown>;
    return [part.startNodeId, part.endNodeId, ...(part.kind === "arc" ? [part.controlNodeId] : [])];
  });
  const key = JSON.stringify(value);
  if (segmentIds.every((id) => loop.includes(Number(id)))) {
    templates.set(key, loop);
    return value;
  }
  const sourceLoop = templates.get(key);
  if (!sourceLoop || sourceLoop.length !== loop.length) return value;
  const source = nodes.get(sourceLoop[0]), target = nodes.get(loop[0]);
  if (!source || !target) return value;
  const delta = [target.x - source.x, target.y - source.y, target.z - source.z];
  if (!sourceLoop.every((id, index) => {
    const from = nodes.get(id), to = nodes.get(loop[index]);
    return from && to && Math.abs(to.x - from.x - delta[0]) < 1e-8 &&
      Math.abs(to.y - from.y - delta[1]) < 1e-8 && Math.abs(to.z - from.z - delta[2]) < 1e-8;
  })) return value;
  const idMap = new Map(sourceLoop.map((id, index) => [id, loop[index]]));
  if (!segmentIds.every((id) => idMap.has(Number(id)))) return value;
  return value.map((segment: OpenFem3DPlateBoundarySegment) => segment.kind === "arc"
    ? { ...segment, startNodeId: idMap.get(segment.startNodeId)!, controlNodeId: idMap.get(segment.controlNodeId)!, endNodeId: idMap.get(segment.endNodeId)! }
    : { ...segment, startNodeId: idMap.get(segment.startNodeId)!, endNodeId: idMap.get(segment.endNodeId)! });
}

function hasCopiedBoundaryReference(value: unknown, loop: number[]): boolean {
  return Array.isArray(value) && value.some((segment: unknown) => {
    if (!segment || typeof segment !== "object" || Array.isArray(segment)) return false;
    const part = segment as Record<string, unknown>;
    return !loop.includes(Number(part.startNodeId)) || !loop.includes(Number(part.endNodeId)) ||
      (part.kind === "arc" && !loop.includes(Number(part.controlNodeId)));
  });
}

function readPlateBoundary(
  value: unknown, loop: number[], nodeIds: Set<number>, nodes: ReadonlyMap<number, OpenFem3DNode>, label: string,
): OpenFem3DPlateBoundarySegment[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length < 2) throw new Error(`${label} bevat geen geldige getekende contour.`);
  const segments = value.map((raw, index): OpenFem3DPlateBoundarySegment => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`${label} bevat een ongeldig randsegment.`);
    const segment = raw as Record<string, unknown>;
    const startNodeId = Number(segment.startNodeId), endNodeId = Number(segment.endNodeId);
    if (!nodeIds.has(startNodeId) || !nodeIds.has(endNodeId) || startNodeId === endNodeId ||
        !loop.includes(startNodeId) || !loop.includes(endNodeId)) {
      throw new Error(`${label} bevat een randsegment met een ongeldige knoopverwijzing.`);
    }
    if (segment.kind === "line") return { kind: "line", startNodeId, endNodeId };
    if (segment.kind === "arc") {
      const controlNodeId = Number(segment.controlNodeId);
      if (!nodeIds.has(controlNodeId) || !loop.includes(controlNodeId) ||
          controlNodeId === startNodeId || controlNodeId === endNodeId) {
        throw new Error(`${label} bevat een boog met een ongeldige stuurknoop.`);
      }
      const start = nodes.get(startNodeId)!, control = nodes.get(controlNodeId)!, end = nodes.get(endNodeId)!;
      const first = [control.x - start.x, control.y - start.y, control.z - start.z];
      const second = [end.x - start.x, end.y - start.y, end.z - start.z];
      const cross = Math.hypot(
        first[1] * second[2] - first[2] * second[1],
        first[2] * second[0] - first[0] * second[2],
        first[0] * second[1] - first[1] * second[0],
      );
      if (cross <= 1e-12 * Math.hypot(...first) * Math.hypot(...second)) {
        throw new Error(`${label} bevat een boog waarvan begin-, stuur- en eindpunt op één lijn liggen.`);
      }
      return { kind: "arc", startNodeId, controlNodeId, endNodeId };
    }
    throw new Error(`${label} bevat een onbekend randsegment op positie ${index + 1}.`);
  });
  for (let index = 0; index < segments.length; index += 1) {
    const current = segments[index], next = segments[(index + 1) % segments.length];
    if (current.endNodeId !== next.startNodeId) throw new Error(`${label} moet één aansluitende gesloten contour vormen.`);
  }
  return segments;
}

function validatePlatePlane(nodes: OpenFem3DNode[], nodeIds: number[], label: string): void {
  const points = nodeIds.map((id) => nodes.find((node) => node.id === id)!);
  const a = points[0];
  let normal: [number, number, number] | null = null;
  for (let index = 1; index < points.length - 1 && !normal; index += 1) {
    const b = points[index], c = points[index + 1];
    const ab = [b.x - a.x, b.y - a.y, b.z - a.z];
    const ac = [c.x - a.x, c.y - a.y, c.z - a.z];
    const candidate: [number, number, number] = [
      ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0],
    ];
    if (Math.hypot(...candidate) > 1e-10) normal = candidate;
  }
  if (!normal) throw new Error(`${label} heeft geen oppervlakte.`);
  const length = Math.hypot(...normal);
  const scale = Math.max(1, ...points.map((point) => Math.hypot(point.x - a.x, point.y - a.y, point.z - a.z)));
  if (points.some((point) => Math.abs((point.x - a.x) * normal![0] + (point.y - a.y) * normal![1] + (point.z - a.z) * normal![2]) / length > scale * 1e-7)) {
    throw new Error(`${label} moet vlak zijn.`);
  }
}

/** An opening must lie strictly in the plate; a touching edge is not a meshable hole. */
function validateOpeningInsidePlate(
  nodes: ReadonlyMap<number, OpenFem3DNode>,
  plateLoop: readonly number[], plateBoundary: readonly OpenFem3DPlateBoundarySegment[] | undefined,
  openingLoop: readonly number[], openingBoundary: readonly OpenFem3DPlateBoundarySegment[] | undefined,
  label: string,
): void {
  const contour = (loop: readonly number[], boundary: readonly OpenFem3DPlateBoundarySegment[] | undefined) => {
    if (!boundary) return loop.map((id) => nodes.get(id)!);
    const points: ArcPoint3D[] = [nodes.get(boundary[0].startNodeId)!];
    for (const segment of boundary) {
      if (segment.kind === "line") points.push(nodes.get(segment.endNodeId)!);
      else {
        const arc = sampleCircularArc3D(
          nodes.get(segment.startNodeId)!, nodes.get(segment.controlNodeId)!, nodes.get(segment.endNodeId)!, 32,
        );
        if (!arc) throw new Error(`${label} bevat een ongeldige cirkelboog.`);
        points.push(...arc.slice(1));
      }
    }
    points.pop(); // de laatste knoop herhaalt de eerste bij een gesloten contour
    return points;
  };
  const outer = contour(plateLoop, plateBoundary);
  const opening = contour(openingLoop, openingBoundary);
  const origin = nodes.get(plateLoop[0])!;
  let normal: [number, number, number] | null = null;
  for (let index = 1; index < plateLoop.length - 1 && !normal; index += 1) {
    const a = nodes.get(plateLoop[index])!, b = nodes.get(plateLoop[index + 1])!;
    const ax = a.x - origin.x, ay = a.y - origin.y, az = a.z - origin.z;
    const bx = b.x - origin.x, by = b.y - origin.y, bz = b.z - origin.z;
    const cross: [number, number, number] = [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
    if (Math.hypot(...cross) > 1e-12) normal = cross;
  }
  if (!normal) throw new Error(`${label} heeft geen vlakke buitencontour.`);
  const norm = Math.hypot(...normal);
  const drop = Math.abs(normal[0]) > Math.abs(normal[1])
    ? Math.abs(normal[0]) > Math.abs(normal[2]) ? "x" : "z"
    : Math.abs(normal[1]) > Math.abs(normal[2]) ? "y" : "z";
  const project = (point: ArcPoint3D) => drop === "x" ? [point.y, point.z] as const
    : drop === "y" ? [point.x, point.z] as const : [point.x, point.y] as const;
  const outline = outer.map(project);
  const span = outer.reduce((largest, point) => Math.max(largest,
    Math.hypot(point.x - origin.x, point.y - origin.y, point.z - origin.z)), 1);
  const tolerance = span * 1e-8;
  const inside = (point: readonly [number, number]) => {
    let contained = false;
    for (let index = 0; index < outline.length; index += 1) {
      const a = outline[index], b = outline[(index + 1) % outline.length];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const lengthSquared = dx * dx + dy * dy;
      const t = lengthSquared > 0
        ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared)) : 0;
      if (Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dy) <= tolerance) return false;
      if ((a[1] > point[1]) !== (b[1] > point[1])
        && point[0] < a[0] + (point[1] - a[1]) * dx / dy) contained = !contained;
    }
    return contained;
  };
  for (const point of [...opening, ...openingLoop.map((id) => nodes.get(id)!)]) {
    const planeDistance = Math.abs(
      (point.x - origin.x) * normal[0] + (point.y - origin.y) * normal[1]
      + (point.z - origin.z) * normal[2]) / norm;
    if (planeDistance > tolerance || !inside(project(point))) {
      throw new Error(`${label} moet volledig binnen de plaat liggen, zonder de buitenrand te raken.`);
    }
  }
}

/**
 * Het eindprofiel van een staaf uit een bestand (issue #73). Leeg, `null` of
 * dezelfde doorsnede als het begin is prismatisch: geen veld. Een eindprofiel
 * dat niet bij het begin past, blijft wél staan: het bestand moet leesbaar
 * blijven (de eigen doorsnede van een gesplitste staaf kan nog moeten laden),
 * en het rekenen, de toetsing en de modelcontrole weigeren de staaf dan met
 * de reden van `bepaalVerloop` — nooit stil prismatisch.
 */
function readProfileNameEnd(raw: Record<string, unknown>, id: number): { profileNameEnd?: string } {
  const value = raw.profileNameEnd;
  if (value === undefined || value === null) return {};
  if (typeof value !== "string") throw new Error(`3D-staaf ${id} heeft een ongeldig eindprofiel.`);
  const profileNameEnd = value.trim();
  if (!profileNameEnd) return {};
  const profileName = typeof raw.profileName === "string" ? raw.profileName.trim() : "";
  if (!profileName) throw new Error(`3D-staaf ${id} heeft een eindprofiel maar geen beginprofiel.`);
  const material = typeof raw.material === "string" ? raw.material.trim() : undefined;
  return openFem3DBeamVerloop({ material, profileName, profileNameEnd }).status === "prismatisch" ? {} : { profileNameEnd };
}

/** Reject malformed geometry at the file boundary instead of showing a partial model. */
export function parseOpenFem3DModel(value: unknown): OpenFem3DModel {
  if (value === undefined) return { nodes: [], beams: [] };
  if (!value || typeof value !== "object") throw new Error("Het 3D-model is geen object.");
  const raw = value as Record<string, unknown>;
  const layers = parseOpenFem3DLayers(raw.layers);
  if (!Array.isArray(raw.nodes) || !Array.isArray(raw.beams)) {
    throw new Error("Het 3D-model mist de lijsten nodes en beams.");
  }
  const nodes: OpenFem3DNode[] = [];
  const nodeIds = new Set<number>();
  for (const item of raw.nodes) {
    if (!item || typeof item !== "object") throw new Error("Het 3D-model bevat een ongeldige knoop.");
    const node = item as Record<string, unknown>;
    if (!Number.isSafeInteger(node.id) || Number(node.id) <= 0 ||
        ![node.x, node.y, node.z].every((n) => typeof n === "number" && Number.isFinite(n)) ||
        nodeIds.has(Number(node.id))) {
      throw new Error("Het 3D-model bevat een knoop met ongeldige of dubbele id/coördinaten.");
    }
    const id = Number(node.id);
    const levelId = readOptionalLevelId(node.levelId, `3D-knoop ${id}`);
    const name = readOptionalName(node.name, `3D-knoop ${id}`);
    nodes.push({
      id, x: Number(node.x), y: Number(node.y), z: Number(node.z),
      ...(levelId !== undefined ? { levelId } : {}),
      ...(name !== undefined ? { name } : {}),
    });
    nodeIds.add(id);
  }
  const nodeIndex = new Map(nodes.map((node) => [node.id, node]));
  const beams: OpenFem3DBeam[] = [];
  const beamIds = new Set<number>();
  for (const item of raw.beams) {
    if (!item || typeof item !== "object") throw new Error("Het 3D-model bevat een ongeldige staaf.");
    const beam = item as Record<string, unknown>;
    const id = Number(beam.id);
    const startNodeId = Number(beam.startNodeId);
    const endNodeId = Number(beam.endNodeId);
    if (!Number.isSafeInteger(beam.id) || id <= 0 || beamIds.has(id) ||
        !Number.isSafeInteger(beam.startNodeId) || !Number.isSafeInteger(beam.endNodeId) ||
        !nodeIds.has(startNodeId) || !nodeIds.has(endNodeId) || startNodeId === endNodeId) {
      throw new Error("Het 3D-model bevat een staaf met ongeldige id of knoopverwijzing.");
    }
    const start = nodeIndex.get(startNodeId)!;
    const end = nodeIndex.get(endNodeId)!;
    if (start.x === end.x && start.y === end.y && start.z === end.z) {
      throw new Error("Het 3D-model bevat een staaf zonder lengte.");
    }
    beams.push({
      id,
      startNodeId,
      endNodeId,
      ...(typeof beam.profileName === "string" && beam.profileName.trim() ? { profileName: beam.profileName.trim() } : {}),
      ...readProfileNameEnd(beam, id),
      ...(typeof beam.material === "string" && beam.material.trim() ? { material: beam.material.trim() } : {}),
      ...(beam.checkConfig && typeof beam.checkConfig === "object" && !Array.isArray(beam.checkConfig)
        ? { checkConfig: beam.checkConfig as BeamCheckConfig }
        : {}),
      ...(beam.rollAngleRad !== undefined
        ? typeof beam.rollAngleRad === "number" && Number.isFinite(beam.rollAngleRad)
          ? { rollAngleRad: beam.rollAngleRad }
          : (() => { throw new Error("Een 3D-staaf bevat een ongeldige profielrotatie."); })()
        : {}),
      ...(beam.shearDeformation !== undefined
        ? typeof beam.shearDeformation === "boolean"
          ? (beam.shearDeformation ? { shearDeformation: true } : {})
          : (() => { throw new Error(`3D-staaf ${id} heeft een ongeldige waarde voor afschuifvervorming.`); })()
        : {}),
      ...(beam.releases !== undefined ? { releases: readEndReleases(beam.releases)! } : {}),
      ...(beam.tensionOnly !== undefined
        ? typeof beam.tensionOnly === "boolean"
          ? (beam.tensionOnly ? { tensionOnly: true } : {})
          : (() => { throw new Error(`3D-staaf ${id} heeft een ongeldige waarde voor trek-alleen.`); })()
        : {}),
      // Staaf op bedding (#106); null in een bestand telt als geen bedding.
      // Niet samen met trek-alleen: die staaf valt op druk weg en zou de grond loslaten.
      ...(beam.bedding !== undefined && beam.bedding !== null
        ? beam.tensionOnly === true
          ? (() => { throw new Error(beddingTrekAlleenMelding(id)); })()
          : { bedding: readOpenFem3DBeamBedding(beam.bedding, start, end, `3D-staaf ${id}`) }
        : {}),
      ...(() => {
        const name = readOptionalName(beam.name, `3D-staaf ${id}`);
        const group = readOptionalName(beam.group, `3D-staaf ${id}`);
        return { ...(name !== undefined ? { name } : {}), ...(group !== undefined ? { group } : {}) };
      })(),
    });
    beamIds.add(id);
  }
  const plates: OpenFem3DPlate[] = [];
  const plateIds = new Set<number>();
  const boundaryTemplates = new Map<string, number[]>();
  if (raw.plates !== undefined && !Array.isArray(raw.plates)) throw new Error("Het 3D-model bevat geen geldige lijst plates.");
  for (const item of (raw.plates ?? []) as unknown[]) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Het 3D-model bevat een ongeldige plaat.");
    const plate = item as Record<string, unknown>;
    const id = Number(plate.id);
    if (!Number.isSafeInteger(plate.id) || id <= 0 || plateIds.has(id)) throw new Error("Het 3D-model bevat een plaat met een ongeldige of dubbele id.");
    const loop = readPlateNodeLoop(plate.nodeIds, nodeIds, `3D-plaat ${id}`);
    validatePlatePlane(nodes, loop, `3D-plaat ${id}`);
    const boundary = readPlateBoundary(repairCopiedBoundary(plate.boundary, loop, boundaryTemplates, nodeIndex), loop, nodeIds, nodeIndex, `3D-plaat ${id}`);
    const thicknessM = Number(plate.thicknessM ?? 0.2);
    const cornerRadiusM = Number(plate.cornerRadiusM ?? 0);
    if (!(thicknessM > 0) || !Number.isFinite(thicknessM) || cornerRadiusM < 0 || !Number.isFinite(cornerRadiusM)) {
      throw new Error(`3D-plaat ${id} heeft een ongeldige dikte of randstraal.`);
    }
    const meshSizeM = plate.meshSizeM === undefined || plate.meshSizeM === null ? undefined : Number(plate.meshSizeM);
    if (meshSizeM !== undefined && !(Number.isFinite(meshSizeM) && meshSizeM >= 0.01)) {
      throw new Error(`3D-plaat ${id} heeft een ongeldige elementgrootte (minimaal 10 mm).`);
    }
    const edgeCount = boundary ? boundary.length : loop.length;
    if (plate.edgeSupports !== undefined && !Array.isArray(plate.edgeSupports)) {
      throw new Error(`3D-plaat ${id} bevat geen geldige lijst randopleggingen.`);
    }
    const edgeSupports: OpenFem3DPlateEdgeSupport[] = [];
    // Het ontwikkelspoor `frame3d` schreef vier randtypen in plaatassen
    // ("free" | "simplySupported" | "clamped"); zet die om naar de globale vorm.
    const rawEdgeSupports = Array.isArray(plate.edgeSupports) && plate.edgeSupports.length > 0
      && isFrame3DEdgeSupportTuple(plate.edgeSupports)
      ? legacyFrame3DEdgeSupportsToOpenFem3D(plate.edgeSupports, loop, nodeIndex, `3D-plaat ${id}`)
      : plate.edgeSupports;
    for (const rawSupport of (rawEdgeSupports ?? []) as unknown[]) {
      if (!rawSupport || typeof rawSupport !== "object" || Array.isArray(rawSupport)) {
        throw new Error(`3D-plaat ${id} bevat een ongeldige randoplegging.`);
      }
      const support = rawSupport as Record<string, unknown>;
      const edge = Number(support.edge);
      if (!Number.isSafeInteger(support.edge) || edge < 0 || edge >= edgeCount
          || edgeSupports.some((item) => item.edge === edge)) {
        throw new Error(`3D-plaat ${id} bevat een randoplegging op een ongeldige of dubbele rand.`);
      }
      const restraints = readSupportRestraints(support);
      if (!SUPPORT_DOF.some((axis) => restraints[axis])) {
        throw new Error(`De randoplegging op rand ${edge + 1} van 3D-plaat ${id} blokkeert niets.`);
      }
      edgeSupports.push({ edge, ...restraints });
    }
    edgeSupports.sort((a, b) => a.edge - b.edge);
    const openingIds = new Set<number>();
    const openings: OpenFem3DPlateOpening[] = [];
    if (plate.openings !== undefined && !Array.isArray(plate.openings)) throw new Error(`3D-plaat ${id} bevat geen geldige lijst openingen.`);
    for (const rawOpening of (plate.openings ?? []) as unknown[]) {
      if (!rawOpening || typeof rawOpening !== "object" || Array.isArray(rawOpening)) throw new Error(`3D-plaat ${id} bevat een ongeldige opening.`);
      const opening = rawOpening as Record<string, unknown>;
      const openingId = Number(opening.id);
      if (!Number.isSafeInteger(opening.id) || openingId <= 0 || openingIds.has(openingId)) throw new Error(`3D-plaat ${id} bevat een opening met ongeldige of dubbele id.`);
      const openingLoop = readPlateNodeLoop(opening.nodeIds, nodeIds, `Opening ${openingId} van 3D-plaat ${id}`);
      validatePlatePlane(nodes, openingLoop, `Opening ${openingId} van 3D-plaat ${id}`);
      const openingBoundary = readPlateBoundary(repairCopiedBoundary(opening.boundary, openingLoop, boundaryTemplates, nodeIndex), openingLoop, nodeIds, nodeIndex, `Opening ${openingId} van 3D-plaat ${id}`);
      validateOpeningInsidePlate(nodeIndex, loop, boundary, openingLoop, openingBoundary,
        `Opening ${openingId} van 3D-plaat ${id}`);
      const openingRadius = Number(opening.cornerRadiusM ?? 0);
      if (openingRadius < 0 || !Number.isFinite(openingRadius)) throw new Error(`Opening ${openingId} heeft een ongeldige randstraal.`);
      // Latei (#97): een latei waarvan de staaf weg is, valt weg (zoals een losgeraakt level).
      const lintel = opening.lintel === undefined || opening.lintel === null
        ? undefined : readOpenFem3DOpeningLintel(opening.lintel, `Opening ${openingId} van 3D-plaat ${id}`);
      openings.push({ id: openingId, nodeIds: openingLoop,
        ...(openingBoundary ? { boundary: openingBoundary } : {}),
        ...(openingRadius > 0 ? { cornerRadiusM: openingRadius } : {}),
        ...(lintel && beamIds.has(lintel.beamId) ? { lintel } : {}) });
      openingIds.add(openingId);
    }
    const levelId = readOptionalLevelId(plate.levelId, `3D-plaat ${id}`);
    // Plaat op bedding (#107); null in een bestand telt als geen bedding.
    const bedding = plate.bedding === undefined || plate.bedding === null
      ? undefined : readOpenFem3DPlateBedding(plate.bedding, `3D-plaat ${id}`);
    // Metselwerkwand (#97); null in een bestand telt als geen metselwerk.
    const masonry = plate.masonry === undefined || plate.masonry === null
      ? undefined : readOpenFem3DMasonryWall(plate.masonry, `3D-plaat ${id}`);
    plates.push({ id, nodeIds: loop, thicknessM,
      ...(boundary ? { boundary } : {}),
      ...(typeof plate.material === "string" && plate.material.trim() ? { material: plate.material.trim() } : {}),
      ...(cornerRadiusM > 0 ? { cornerRadiusM } : {}), ...(openings.length ? { openings } : {}),
      ...(levelId !== undefined ? { levelId } : {}),
      ...(meshSizeM !== undefined ? { meshSizeM } : {}),
      ...(edgeSupports.length ? { edgeSupports } : {}),
      ...(bedding ? { bedding } : {}),
      ...(masonry ? { masonry } : {}) });
    plateIds.add(id);
  }
  // Een plaat ligt pas op een level als AL haar knopen (ook die van de
  // openingen) aan datzelfde level hangen. Een koppeling die daar niet aan
  // voldoet — alleen denkbaar in een met de hand bewerkt bestand — valt weg;
  // de geometrie zelf blijft precies zoals opgeslagen.
  for (let index = 0; index < plates.length; index += 1) {
    const plate = plates[index];
    if (plate.levelId === undefined) continue;
    const plateNodeIds = [...plate.nodeIds, ...(plate.openings ?? []).flatMap((opening) => opening.nodeIds)];
    if (plateNodeIds.every((nodeId) => nodeIndex.get(nodeId)?.levelId === plate.levelId)) continue;
    const { levelId: _unlinked, ...rest } = plate;
    plates[index] = rest;
  }
  const supports: OpenFem3DSupport[] = [];
  const supportedNodes = new Set<number>();
  if (raw.supports !== undefined && !Array.isArray(raw.supports)) {
    throw new Error("Het 3D-model bevat geen geldige lijst supports.");
  }
  for (const item of (raw.supports ?? []) as unknown[]) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("Het 3D-model bevat een ongeldige oplegging.");
    }
    const support = item as Record<string, unknown>;
    const nodeId = Number(support.nodeId);
    if (!Number.isSafeInteger(support.nodeId) || !nodeIds.has(nodeId) || supportedNodes.has(nodeId)) {
      throw new Error("Het 3D-model bevat een oplegging met ongeldige, dubbele of ontbrekende knoopverwijzing.");
    }
    const restraints = readSupportRestraints(support);
    const springs = readSupportSprings(support.springs);
    const prescribed = readPrescribedDisplacements(support.prescribed);
    if (!SUPPORT_DOF.some((axis) => restraints[axis]) && !springs) {
      throw new Error("Een 3D-oplegging moet minstens één vrijheidsgraad blokkeren of veren.");
    }
    for (let index = 0; index < SUPPORT_DOF.length; index += 1) {
      if (restraints[SUPPORT_DOF[index]] && springs?.[SPRING_DOF[index]] !== undefined) {
        throw new Error("Een 3D-oplegging kan dezelfde vrijheidsgraad niet tegelijk blokkeren en veren.");
      }
      if (prescribed?.[PRESCRIBED_DOF[index]] !== undefined && !restraints[SUPPORT_DOF[index]]) {
        throw new Error("Een opgelegde 3D-verplaatsing vereist een geblokkeerde vrijheidsgraad.");
      }
    }
    supports.push({ nodeId, ...restraints, ...(springs ? { springs } : {}), ...(prescribed ? { prescribed } : {}) });
    supportedNodes.add(nodeId);
  }

  const loads: OpenFem3DNodalLoad[] = [];
  const loadIds = new Set<number>();
  if (raw.loads !== undefined && !Array.isArray(raw.loads)) {
    throw new Error("Het 3D-model bevat geen geldige lijst loads.");
  }
  for (const item of (raw.loads ?? []) as unknown[]) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("Het 3D-model bevat een ongeldige knoopbelasting.");
    }
    const load = item as Record<string, unknown>;
    const id = Number(load.id);
    const nodeId = Number(load.nodeId);
    if (!Number.isSafeInteger(load.id) || id <= 0 || loadIds.has(id) ||
        !Number.isSafeInteger(load.nodeId) || !nodeIds.has(nodeId)) {
      throw new Error("Het 3D-model bevat een knoopbelasting met ongeldige, dubbele of ontbrekende knoopverwijzing.");
    }
    const caseId = readOptionalCaseId(load.caseId);
    let generated: OpenFem3DNodalLoad["generated"];
    if (load.generated !== undefined) {
      const origin = load.generated as Record<string, unknown>;
      if (!origin || typeof origin !== "object" || Array.isArray(origin)
        || origin.source !== "nbc2025-partial-wind"
        || typeof origin.key !== "string" || !origin.key.trim()
        || typeof origin.sourceReference !== "string" || !origin.sourceReference.trim()
        || caseId === undefined) {
        throw new Error("Knoopbelasting heeft een ongeldige NBC-deelwindherkomst.");
      }
      generated = { source: "nbc2025-partial-wind", key: origin.key, sourceReference: origin.sourceReference };
    }
    loads.push({ id, nodeId, ...readNodalLoadComponents(load), ...(caseId !== undefined ? { caseId } : {}),
      ...(generated ? { generated } : {}) });
    loadIds.add(id);
  }
  const analysisMaterials = readOpenFem3DAnalysisMaterials(raw.analysisMaterials);
  const model: OpenFem3DModel = {
    nodes, beams, ...(raw.plates !== undefined ? { plates } : {}), supports, loads,
    ...(layers ? { layers } : {}),
    ...(analysisMaterials ? { analysisMaterials } : {}),
    ...(raw.memberLoads !== undefined ? { memberLoads: [] } : {}),
    ...(raw.memberPointLoads !== undefined ? { memberPointLoads: [] } : {}),
    ...(raw.thermalLoads !== undefined ? { thermalLoads: [] } : {}),
    ...(raw.surfaceLoads !== undefined ? { surfaceLoads: [] } : {}),
  };
  // Modelinstellingen voor trek-alleen staven: alleen `true` blijft staan.
  for (const key of ["tensionOnlyFitAfterPermanent", "tensionOnlyCrossRule"] as const) {
    if (raw[key] === undefined) continue;
    if (typeof raw[key] !== "boolean") throw new Error(`Het 3D-model heeft een ongeldige instelling ${key} (true of false).`);
    if (raw[key]) model[key] = true;
  }
  const memberLoadIds = new Set<number>();
  if (raw.memberLoads !== undefined && !Array.isArray(raw.memberLoads)) {
    throw new Error("Het 3D-model bevat geen geldige lijst memberLoads.");
  }
  for (const item of (raw.memberLoads ?? []) as unknown[]) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("Het 3D-model bevat een ongeldige staafbelasting.");
    }
    const load = item as Record<string, unknown>;
    const id = Number(load.id);
    const beamId = Number(load.beamId);
    if (!Number.isSafeInteger(load.id) || id <= 0 || memberLoadIds.has(id) ||
        !Number.isSafeInteger(load.beamId) || !beamIds.has(beamId)) {
      throw new Error("Het 3D-model bevat een staafbelasting met ongeldige, dubbele of ontbrekende staafverwijzing.");
    }
    model.memberLoads!.push(readMemberLoad(load, model, id, beamId));
    memberLoadIds.add(id);
  }
  const memberPointLoadIds = new Set<number>();
  if (raw.memberPointLoads !== undefined && !Array.isArray(raw.memberPointLoads)) {
    throw new Error("Het 3D-model bevat geen geldige lijst memberPointLoads.");
  }
  for (const item of (raw.memberPointLoads ?? []) as unknown[]) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("Het 3D-model bevat een ongeldige staafpuntlast.");
    }
    const load = item as Record<string, unknown>;
    const id = Number(load.id), beamId = Number(load.beamId);
    if (!Number.isSafeInteger(load.id) || id <= 0 || memberPointLoadIds.has(id) ||
        !Number.isSafeInteger(load.beamId) || !beamIds.has(beamId)) {
      throw new Error("Het 3D-model bevat een staafpuntlast met ongeldige, dubbele of ontbrekende staafverwijzing.");
    }
    model.memberPointLoads!.push(readMemberPointLoad(load, model, id, beamId));
    memberPointLoadIds.add(id);
  }
  const thermalLoadIds = new Set<number>();
  if (raw.thermalLoads !== undefined && !Array.isArray(raw.thermalLoads)) {
    throw new Error("Het 3D-model bevat geen geldige lijst thermalLoads.");
  }
  for (const item of (raw.thermalLoads ?? []) as unknown[]) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("Het 3D-model bevat een ongeldige temperatuurbelasting.");
    }
    const load = item as Record<string, unknown>;
    const id = Number(load.id), beamId = Number(load.beamId);
    if (!Number.isSafeInteger(load.id) || id <= 0 || thermalLoadIds.has(id) ||
        !Number.isSafeInteger(load.beamId) || !beamIds.has(beamId)) {
      throw new Error("Het 3D-model bevat een temperatuurbelasting met ongeldige, dubbele of ontbrekende staafverwijzing.");
    }
    model.thermalLoads!.push(readThermalLoad(load, model, id, beamId));
    thermalLoadIds.add(id);
  }
  const surfaceLoadIds = new Set<number>();
  if (raw.surfaceLoads !== undefined && !Array.isArray(raw.surfaceLoads)) throw new Error("Het 3D-model bevat geen geldige lijst surfaceLoads.");
  for (const item of (raw.surfaceLoads ?? []) as unknown[]) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Het 3D-model bevat een ongeldige oppervlaktebelasting.");
    const load = item as Record<string, unknown>;
    const id = Number(load.id), plateId = Number(load.plateId);
    const qx = Number(load.qx ?? 0), qy = Number(load.qy ?? 0), qz = Number(load.qz ?? 0);
    if (!Number.isSafeInteger(load.id) || id <= 0 || surfaceLoadIds.has(id) || !Number.isSafeInteger(load.plateId) || !plateIds.has(plateId) ||
        ![qx, qy, qz].every(Number.isFinite) || [qx, qy, qz].every((component) => component === 0)) {
      throw new Error("Het 3D-model bevat een oppervlaktebelasting met ongeldige waarden of plaatverwijzing.");
    }
    const caseId = readOptionalCaseId(load.caseId);
    model.surfaceLoads!.push({ id, plateId, ...(caseId !== undefined ? { caseId } : {}), qx, qy, qz });
    surfaceLoadIds.add(id);
  }
  if (raw.loadPanels !== undefined) {
    if (!Array.isArray(raw.loadPanels)) throw new Error("Het 3D-model bevat geen geldige lijst loadPanels.");
    const loadPanelIds = new Set<number>();
    model.loadPanels = raw.loadPanels.map((item: unknown) => {
      const panel = readLoadPanel(item, nodeIds, beamIds);
      if (loadPanelIds.has(panel.id)) throw new Error(`Het 3D-model bevat belastingvlak ${panel.id} twee keer.`);
      loadPanelIds.add(panel.id);
      return panel;
    });
  }
  if (raw.envelopePanels !== undefined) {
    if (!Array.isArray(raw.envelopePanels)) throw new Error("Het 3D-model bevat geen geldige lijst envelopePanels.");
    const ids = new Set<number>();
    model.envelopePanels = raw.envelopePanels.map((item: unknown) => {
      const panel = readEnvelopePanel(item, nodeIds);
      if (ids.has(panel.id)) throw new Error(`Het 3D-model bevat schilpaneel ${panel.id} twee keer.`);
      ids.add(panel.id);
      return panel;
    });
  }
  if (raw.diaphragms !== undefined) {
    if (!Array.isArray(raw.diaphragms)) throw new Error("Het 3D-model bevat geen geldige lijst diaphragms.");
    model.diaphragms = readDiaphragms(raw.diaphragms, nodeIds);
  }
  if (raw.generatedNodeIds !== undefined) {
    const generatedNodeIds = raw.generatedNodeIds;
    if (!Array.isArray(generatedNodeIds)
      || generatedNodeIds.some((id: unknown, index: number) =>
        !Number.isSafeInteger(id) || !nodeIds.has(Number(id)) || generatedNodeIds.indexOf(id) !== index)) {
      throw new Error("Het 3D-model bevat ongeldige of dubbele hulpknopen van de belastinggenerator.");
    }
    model.generatedNodeIds = generatedNodeIds as number[];
  }
  // Laagtoewijzingen zijn uitsluitend model- en weergavemetadata. De
  // bestaande meetkundige poort hierboven blijft voor oude bestanden gelijk.
  const layerIndex = layers ?? [OPEN_FEM_3D_DEFAULT_LAYER];
  for (const key of ["nodes", "beams", "plates", "supports", "loads", "memberLoads",
    "memberPointLoads", "thermalLoads", "surfaceLoads", "loadPanels", "envelopePanels"] as const) {
    const parsed = model[key] as Array<{ id?: number; nodeId?: number; layerId?: number }> | undefined;
    const source = raw[key] as Array<Record<string, unknown>> | undefined;
    if (!parsed || !source) continue;
    const idKey = key === "supports" ? "nodeId" : "id";
    const originals = new Map(source.map((item) => [item[idKey], item]));
    for (const item of parsed) {
      const original = originals.get(item[idKey]);
      const layerId = readOpenFem3DLayerId(original?.layerId, layerIndex, `3D-${key} ${item[idKey]}`);
      if (layerId !== undefined) item.layerId = layerId;
    }
  }
  attachOpenFem3DNativeFields(raw, model);
  return model;
}

const LOAD_PANEL_DIRECTIONS: readonly OpenFem3DLoadPanelDirection[] = ["gravity", "normal", "verticalSurface"];
const LOAD_PANEL_DISTRIBUTIONS: readonly OpenFem3DLoadPanelDistribution[] = ["oneWay", "twoWay"];

function readEnvelopePanel(value: unknown, nodeIds: Set<number>): OpenFem3DEnvelopePanel {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Het 3D-model bevat een ongeldig schilpaneel.");
  const raw = value as Record<string, unknown>;
  const id = Number(raw.id);
  if (!Number.isSafeInteger(raw.id) || id <= 0) throw new Error("Het 3D-model bevat een schilpaneel met een ongeldige id.");
  const label = `3D-schilpaneel ${id}`;
  const loop = readPlateNodeLoop(raw.nodeIds, nodeIds, label);
  if (raw.type !== "facade" && raw.type !== "roof") throw new Error(`${label} heeft een ongeldig type.`);
  if (!LOAD_PANEL_DISTRIBUTIONS.includes(raw.distribution as OpenFem3DLoadPanelDistribution)) {
    throw new Error(`${label} heeft een ongeldige afdracht.`);
  }
  if (raw.flipOuterSide !== undefined && typeof raw.flipOuterSide !== "boolean") {
    throw new Error(`${label} heeft een ongeldige buitenzijde.`);
  }
  const weight = raw.claddingWeightKnPerM2;
  if (weight !== undefined && (typeof weight !== "number" || !Number.isFinite(weight) || weight < 0)) {
    throw new Error(`${label} heeft een ongeldig bekledingsgewicht.`);
  }
  let spanDirection: OpenFem3DVector | undefined;
  if (raw.spanDirection !== undefined) {
    const vector = raw.spanDirection as Record<string, unknown> | null;
    if (!vector || typeof vector !== "object" || Array.isArray(vector)
      || !["x", "y", "z"].every((axis) => typeof vector[axis] === "number" && Number.isFinite(vector[axis]))
      || Math.hypot(Number(vector.x), Number(vector.y), Number(vector.z)) === 0) {
      throw new Error(`${label} heeft een ongeldige overspanningsrichting.`);
    }
    spanDirection = { x: Number(vector.x), y: Number(vector.y), z: Number(vector.z) };
  }
  if (raw.distribution === "oneWay" && !spanDirection) throw new Error(`${label} mist de overspanningsrichting.`);
  let openings: OpenFem3DEnvelopePanel["openings"];
  if (raw.openings !== undefined) {
    if (!Array.isArray(raw.openings)) throw new Error(`${label} bevat een ongeldige lijst openingen.`);
    const openingIds = new Set<number>();
    openings = raw.openings.map((item: unknown) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`${label} bevat een ongeldige opening.`);
      const opening = item as Record<string, unknown>;
      const openingId = Number(opening.id);
      if (!Number.isSafeInteger(opening.id) || openingId <= 0 || openingIds.has(openingId)) {
        throw new Error(`${label} bevat een opening met een ongeldige of dubbele id.`);
      }
      openingIds.add(openingId);
      return { id: openingId, nodeIds: readPlateNodeLoop(opening.nodeIds, nodeIds, `Opening ${openingId} van ${label}`) };
    });
  }
  return {
    id, nodeIds: loop, type: raw.type, distribution: raw.distribution as OpenFem3DLoadPanelDistribution,
    ...(raw.flipOuterSide ? { flipOuterSide: true } : {}),
    ...(spanDirection ? { spanDirection } : {}),
    ...(openings?.length ? { openings } : {}),
    ...(weight !== undefined ? { claddingWeightKnPerM2: weight } : {}),
    ...(readOptionalName(raw.name, label) ? { name: readOptionalName(raw.name, label) } : {}),
  };
}

/**
 * Alleen de STRUCTUUR van een belastingvlak wordt hier gekeurd (knopen,
 * waarden, keuzes). De meetkunde — vlak, niet zelfsnijdend, liggers in het
 * vlak — hangt af van knoopcoördinaten die na het tekenen nog kunnen
 * verschuiven. Die keuring zit daarom in de afdracht (`openFem3dLoadPanels`),
 * die het rekenen blokkeert met een melding. Zo blijft een project met een
 * scheef getrokken vlak te openen en op te slaan in plaats van onleesbaar.
 */
function readLoadPanel(value: unknown, nodeIds: Set<number>, beamIds: Set<number>): OpenFem3DLoadPanel {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Het 3D-model bevat een ongeldig belastingvlak.");
  }
  const raw = value as Record<string, unknown>;
  const id = Number(raw.id);
  if (!Number.isSafeInteger(raw.id) || id <= 0) throw new Error("Het 3D-model bevat een belastingvlak met een ongeldige id.");
  const label = `3D-belastingvlak ${id}`;
  const loop = readPlateNodeLoop(raw.nodeIds, nodeIds, label);
  const q = raw.q;
  if (typeof q !== "number" || !Number.isFinite(q) || q === 0) {
    throw new Error(`${label} heeft een ongeldige intensiteit q; geef een eindige waarde ongelijk aan 0 in kN/m².`);
  }
  if (!LOAD_PANEL_DIRECTIONS.includes(raw.direction as OpenFem3DLoadPanelDirection)) {
    throw new Error(`${label} heeft een onbekende lastrichting ${JSON.stringify(raw.direction)}; kies gravity, normal of verticalSurface.`);
  }
  if (!LOAD_PANEL_DISTRIBUTIONS.includes(raw.distribution as OpenFem3DLoadPanelDistribution)) {
    throw new Error(`${label} heeft een onbekende afdracht ${JSON.stringify(raw.distribution)}; kies oneWay of twoWay.`);
  }
  let spanDirection: OpenFem3DVector | undefined;
  if (raw.spanDirection !== undefined) {
    const vector = raw.spanDirection as Record<string, unknown> | null;
    if (!vector || typeof vector !== "object" || Array.isArray(vector)
      || !["x", "y", "z"].every((axis) => typeof vector[axis] === "number" && Number.isFinite(vector[axis]))
      || Math.hypot(Number(vector.x), Number(vector.y), Number(vector.z)) === 0) {
      throw new Error(`${label} heeft een ongeldige overspanningsrichting; geef een vector {x, y, z} ongelijk aan nul.`);
    }
    spanDirection = { x: Number(vector.x), y: Number(vector.y), z: Number(vector.z) };
  }
  if (raw.distribution === "oneWay" && !spanDirection) {
    throw new Error(`${label} draagt in één richting af maar mist de overspanningsrichting.`);
  }
  let excludedBeamIds: number[] | undefined;
  if (raw.excludedBeamIds !== undefined) {
    if (!Array.isArray(raw.excludedBeamIds)) throw new Error(`${label} bevat geen geldige lijst uitgesloten staven.`);
    const ids = raw.excludedBeamIds.map(Number);
    if (ids.some((beamId, index) => !Number.isSafeInteger(beamId) || !beamIds.has(beamId) || ids.indexOf(beamId) !== index)) {
      throw new Error(`${label} sluit een ontbrekende of dubbele staaf uit.`);
    }
    if (ids.length > 0) excludedBeamIds = ids;
  }
  const caseId = readOptionalCaseId(raw.caseId);
  let generated: OpenFem3DLoadPanel["generated"];
  if (raw.generated !== undefined) {
    const value = raw.generated;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} heeft een ongeldige herkomst.`);
    const origin = value as Record<string, unknown>;
    if (origin.source !== "envelope3d"
      || typeof origin.key !== "string" || !origin.key.trim()
      || !Number.isSafeInteger(origin.panelId) || Number(origin.panelId) <= 0
      || typeof origin.zone !== "string" || !origin.zone.trim()
      || typeof origin.coefficient !== "number" || !Number.isFinite(origin.coefficient)
      || typeof origin.referencePressureKnPerM2 !== "number" || !Number.isFinite(origin.referencePressureKnPerM2)
      || typeof origin.sourceReference !== "string" || !origin.sourceReference.trim()
      || (origin.internalPressureCoefficient !== undefined
        && (typeof origin.internalPressureCoefficient !== "number" || !Number.isFinite(origin.internalPressureCoefficient)))
      || (origin.windInternalPressureDerivation !== undefined
        && (origin.internalPressureCoefficient === undefined
          || !Array.isArray(origin.windInternalPressureDerivation)
          || origin.windInternalPressureDerivation.length === 0
          || !origin.windInternalPressureDerivation.every((line: unknown) => line !== null
            && typeof line === "object" && !Array.isArray(line)
            && ["symbool", "waarde", "bron"].every((key) =>
              typeof (line as Record<string, unknown>)[key] === "string"
              && Boolean((line as Record<string, string>)[key].trim())))))
      || (origin.windCodeId !== undefined && (typeof origin.windCodeId !== "string" || !origin.windCodeId.trim()))
      || (origin.windStructuralFactor !== undefined
        && (typeof origin.windStructuralFactor !== "number" || !Number.isFinite(origin.windStructuralFactor)
          || origin.windStructuralFactor <= 0 || origin.internalPressureCoefficient === undefined))
      || (origin.windReferenceHeightM !== undefined
        && (typeof origin.windReferenceHeightM !== "number" || !Number.isFinite(origin.windReferenceHeightM)
          || origin.windReferenceHeightM <= 0 || origin.windReferenceHeightM > 200))
      || (origin.windPressureDerivation !== undefined
        && (!Array.isArray(origin.windPressureDerivation) || origin.windPressureDerivation.length === 0
          || !origin.windPressureDerivation.every((line: unknown) => line !== null
            && typeof line === "object" && !Array.isArray(line)
            && ["symbool", "waarde", "bron"].every((key) =>
              typeof (line as Record<string, unknown>)[key] === "string"
              && Boolean((line as Record<string, string>)[key].trim())))))
      || (origin.windPressureDerivation !== undefined) !== (origin.windReferenceHeightM !== undefined)
      || (origin.windPressureMethod !== undefined
        && ((origin.windPressureMethod !== "en-terreinprofiel"
          && origin.windPressureMethod !== "handmatig-opgegeven"
          && origin.windPressureMethod !== "nbc-static")
          || origin.windPressureDerivation === undefined))
      || (origin.windPressureMethod === "nbc-static"
        && (origin.windCodeId !== "ca-nbc-2025" || origin.windPressurePlan === undefined))) {
      throw new Error(`${label} heeft een ongeldige herkomst van de 3D-belastinggenerator.`);
    }
    let windPressurePlan: WindSurfacePressurePlan | undefined;
    if (origin.windPressurePlan !== undefined) {
      try {
        windPressurePlan = parseWindSurfacePressurePlan(origin.windPressurePlan);
        if (origin.windPressureMethod !== "nbc-static" || windPressurePlan.codeId !== origin.windCodeId
          || windPressurePlan.zone !== origin.zone || windPressurePlan.basis.kind !== "separate-pressures"
          || typeof raw.q !== "number"
          || Math.abs(Math.abs(raw.q) - Math.abs(windPressurePlan.pressure.outwardKnPerM2)) > 1e-8) {
          throw new Error("Winddrukplan past niet bij de gegenereerde belasting.");
        }
      } catch {
        throw new Error(`${label} heeft een ongeldig winddrukplan.`);
      }
    }
    generated = {
      source: "envelope3d", key: origin.key, panelId: Number(origin.panelId), zone: origin.zone,
      coefficient: origin.coefficient, referencePressureKnPerM2: origin.referencePressureKnPerM2,
      ...(origin.internalPressureCoefficient !== undefined
        ? { internalPressureCoefficient: origin.internalPressureCoefficient } : {}),
      ...(origin.windInternalPressureDerivation !== undefined
        ? { windInternalPressureDerivation: (origin.windInternalPressureDerivation as AfleidingsRegel[])
          .map((line) => ({ symbool: line.symbool, waarde: line.waarde, bron: line.bron })) } : {}),
      ...(origin.windCodeId !== undefined ? { windCodeId: origin.windCodeId } : {}),
      ...(origin.windStructuralFactor !== undefined ? { windStructuralFactor: origin.windStructuralFactor } : {}),
      ...(origin.windReferenceHeightM !== undefined ? { windReferenceHeightM: origin.windReferenceHeightM } : {}),
      ...(origin.windPressureMethod !== undefined ? { windPressureMethod: origin.windPressureMethod } : {}),
      ...(windPressurePlan ? { windPressurePlan } : {}),
      ...(origin.windPressureDerivation !== undefined
        ? { windPressureDerivation: (origin.windPressureDerivation as AfleidingsRegel[])
          .map((line) => ({ symbool: line.symbool, waarde: line.waarde, bron: line.bron })) } : {}),
      sourceReference: origin.sourceReference,
    };
  }
  let openings: OpenFem3DLoadPanel["openings"];
  if (raw.openings !== undefined) {
    if (!Array.isArray(raw.openings)) throw new Error(`${label} bevat een ongeldige lijst openingen.`);
    const ids = new Set<number>();
    openings = raw.openings.map((item: unknown) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`${label} bevat een ongeldige opening.`);
      const opening = item as Record<string, unknown>;
      const openingId = Number(opening.id);
      if (!Number.isSafeInteger(opening.id) || openingId <= 0 || ids.has(openingId)) throw new Error(`${label} bevat een opening met ongeldige of dubbele id.`);
      ids.add(openingId);
      return { id: openingId, nodeIds: readPlateNodeLoop(opening.nodeIds, nodeIds, `Opening ${openingId} van ${label}`) };
    });
  }
  return {
    id, nodeIds: loop,
    ...(caseId !== undefined ? { caseId } : {}),
    ...(generated ? { generated } : {}),
    q,
    direction: raw.direction as OpenFem3DLoadPanelDirection,
    distribution: raw.distribution as OpenFem3DLoadPanelDistribution,
    ...(spanDirection ? { spanDirection } : {}),
    ...(excludedBeamIds ? { excludedBeamIds } : {}),
    ...(openings?.length ? { openings } : {}),
  };
}

/** Naam of groep uit een bronmodel; leeg of null = geen. */
function readOptionalName(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error(`${label} heeft een ongeldige naam of groep.`);
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Alleen de STRUCTUUR van de schijven wordt hier gekeurd: bestaande knopen,
 * geen knoop in twee schijven. Of alle knopen op één hoogte liggen hangt af
 * van coördinaten die na het openen nog kunnen verschuiven; dat keurt de
 * rekenroute, die dan het rekenen blokkeert met een melding.
 */
function readDiaphragms(items: unknown[], nodeIds: Set<number>): OpenFem3DDiaphragm[] {
  const ids = new Set<number>();
  const owner = new Map<number, number>();
  return items.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Het 3D-model bevat een ongeldige schijf.");
    const raw = item as Record<string, unknown>;
    const id = Number(raw.id);
    if (!Number.isSafeInteger(raw.id) || id <= 0 || ids.has(id)) throw new Error("Het 3D-model bevat een schijf met een ongeldige of dubbele id.");
    ids.add(id);
    if (!Array.isArray(raw.nodeIds) || raw.nodeIds.length < 2) throw new Error(`Schijf ${id} koppelt minder dan twee knopen.`);
    const nodes = raw.nodeIds.map(Number);
    for (const nodeId of nodes) {
      if (!Number.isSafeInteger(nodeId) || !nodeIds.has(nodeId)) throw new Error(`Schijf ${id} verwijst naar een ontbrekende knoop.`);
      const other = owner.get(nodeId);
      if (other === id) throw new Error(`Schijf ${id} noemt knoop ${nodeId} twee keer.`);
      if (other !== undefined) throw new Error(`Knoop ${nodeId} hoort bij schijf ${other} én schijf ${id}; een knoop hoort bij hoogstens één schijf.`);
      owner.set(nodeId, id);
    }
    const name = readOptionalName(raw.name, `Schijf ${id}`);
    return { id, nodeIds: nodes, ...(name !== undefined ? { name } : {}) };
  });
}

export function setOpenFem3DSupport(
  model: OpenFem3DModel, nodeId: number, restraints: OpenFem3DSupportRestraints,
): OpenFem3DModel {
  requireNode(model, nodeId);
  const previous = model.supports ?? [];
  const existing = previous.find((item) => item.nodeId === nodeId);
  const parsed = readSupportRestraints(restraints as unknown as Record<string, unknown>);
  const springs = existing?.springs ? { ...existing.springs } : undefined;
  const prescribed = existing?.prescribed ? { ...existing.prescribed } : undefined;
  for (let index = 0; index < SUPPORT_DOF.length; index += 1) {
    if (parsed[SUPPORT_DOF[index]]) {
      if (springs) delete springs[SPRING_DOF[index]];
    } else if (prescribed) {
      delete prescribed[PRESCRIBED_DOF[index]];
    }
  }
  const support: OpenFem3DSupport = {
    nodeId, ...parsed,
    ...(springs && Object.keys(springs).length > 0 ? { springs } : {}),
    ...(prescribed && Object.keys(prescribed).length > 0 ? { prescribed } : {}),
  };
  return {
    ...model,
    supports: previous.some((item) => item.nodeId === nodeId)
      ? previous.map((item) => item.nodeId === nodeId ? support : item)
      : [...previous, support],
  };
}

/** Zet de zes globale oplegveren en maakt de bijbehorende vaste DOF vrij. */
export function setOpenFem3DSupportSprings(
  model: OpenFem3DModel, nodeId: number, springs: OpenFem3DSupportSprings,
): OpenFem3DModel {
  requireNode(model, nodeId);
  const parsed = readSupportSprings(springs);
  const previous = model.supports ?? [];
  const existing = previous.find((item) => item.nodeId === nodeId);
  const restraints: OpenFem3DSupportRestraints = existing
    ? Object.fromEntries(SUPPORT_DOF.map((axis) => [axis, existing[axis]])) as unknown as OpenFem3DSupportRestraints
    : { ux: false, uy: false, uz: false, rx: false, ry: false, rz: false };
  const prescribed = existing?.prescribed ? { ...existing.prescribed } : undefined;
  for (let index = 0; index < SUPPORT_DOF.length; index += 1) {
    if (parsed?.[SPRING_DOF[index]] !== undefined) {
      restraints[SUPPORT_DOF[index]] = false;
      if (prescribed) delete prescribed[PRESCRIBED_DOF[index]];
    }
  }
  if (!parsed && !SUPPORT_DOF.some((axis) => restraints[axis])) return removeOpenFem3DSupport(model, nodeId);
  const support: OpenFem3DSupport = {
    nodeId, ...restraints,
    ...(parsed ? { springs: parsed } : {}),
    ...(prescribed && Object.keys(prescribed).length > 0 ? { prescribed } : {}),
  };
  return {
    ...model,
    supports: existing
      ? previous.map((item) => item.nodeId === nodeId ? support : item)
      : [...previous, support],
  };
}

/** Zet opgelegde waarden op globale DOF's en blokkeert die DOF's automatisch. */
export function setOpenFem3DSupportPrescribed(
  model: OpenFem3DModel, nodeId: number, values: OpenFem3DPrescribedDisplacements,
): OpenFem3DModel {
  requireNode(model, nodeId);
  const prescribed = readPrescribedDisplacements(values);
  const previous = model.supports ?? [];
  const existing = previous.find((item) => item.nodeId === nodeId);
  if (!existing && !prescribed) return model;
  const restraints: OpenFem3DSupportRestraints = existing
    ? Object.fromEntries(SUPPORT_DOF.map((axis) => [axis, existing[axis]])) as unknown as OpenFem3DSupportRestraints
    : { ux: false, uy: false, uz: false, rx: false, ry: false, rz: false };
  const springs = existing?.springs ? { ...existing.springs } : undefined;
  for (let index = 0; index < SUPPORT_DOF.length; index += 1) {
    if (prescribed?.[PRESCRIBED_DOF[index]] !== undefined) {
      restraints[SUPPORT_DOF[index]] = true;
      if (springs) delete springs[SPRING_DOF[index]];
    }
  }
  const support: OpenFem3DSupport = {
    nodeId, ...restraints,
    ...(springs && Object.keys(springs).length > 0 ? { springs } : {}),
    ...(prescribed ? { prescribed } : {}),
  };
  return {
    ...model,
    supports: existing
      ? previous.map((item) => item.nodeId === nodeId ? support : item)
      : [...previous, support],
  };
}

export function removeOpenFem3DSupport(model: OpenFem3DModel, nodeId: number): OpenFem3DModel {
  return { ...model, supports: (model.supports ?? []).filter((item) => item.nodeId !== nodeId) };
}

export function addOpenFem3DNodalLoad(
  model: OpenFem3DModel, nodeId: number, components: OpenFem3DNodalLoadComponents, caseId?: number,
): OpenFem3DModel {
  requireNode(model, nodeId);
  const values = readNodalLoadComponents(components as unknown as Record<string, unknown>);
  const validCaseId = readOptionalCaseId(caseId);
  const previous = model.loads ?? [];
  const id = nextEntityId(previous);
  return { ...model, loads: [...previous, { id, nodeId, ...values, ...(validCaseId !== undefined ? { caseId: validCaseId } : {}) }] };
}

export function updateOpenFem3DNodalLoad(
  model: OpenFem3DModel, loadId: number, components: OpenFem3DNodalLoadComponents,
): OpenFem3DModel {
  const previous = model.loads ?? [];
  if (!previous.some((load) => load.id === loadId)) throw new Error(`3D-knoopbelasting ${loadId} bestaat niet.`);
  const values = readNodalLoadComponents(components as unknown as Record<string, unknown>);
  return {
    ...model,
    loads: previous.map((load) => load.id === loadId ? { ...load, ...values } : load),
  };
}

export function removeOpenFem3DNodalLoad(model: OpenFem3DModel, loadId: number): OpenFem3DModel {
  return { ...model, loads: (model.loads ?? []).filter((load) => load.id !== loadId) };
}

export function addOpenFem3DMemberLoad(
  model: OpenFem3DModel,
  beamId: number,
  values: OpenFem3DMemberLoadValues,
  caseId?: number,
): OpenFem3DModel {
  const previous = model.memberLoads ?? [];
  const id = nextEntityId(previous);
  const load = readMemberLoad({ ...values, ...(caseId !== undefined ? { caseId } : {}) } as unknown as Record<string, unknown>, model, id, beamId);
  return { ...model, memberLoads: [...previous, load] };
}

export function updateOpenFem3DMemberLoad(
  model: OpenFem3DModel,
  loadId: number,
  values: OpenFem3DMemberLoadValues,
): OpenFem3DModel {
  const previous = model.memberLoads ?? [];
  const old = previous.find((load) => load.id === loadId);
  if (!old) throw new Error(`3D-staafbelasting ${loadId} bestaat niet.`);
  const load = readMemberLoad({ ...values, ...(old.caseId !== undefined ? { caseId: old.caseId } : {}) } as unknown as Record<string, unknown>, model, loadId, old.beamId);
  return { ...model, memberLoads: previous.map((item) => item.id === loadId ? load : item) };
}

export function removeOpenFem3DMemberLoad(model: OpenFem3DModel, loadId: number): OpenFem3DModel {
  return { ...model, memberLoads: (model.memberLoads ?? []).filter((load) => load.id !== loadId) };
}

export function addOpenFem3DMemberPointLoad(
  model: OpenFem3DModel,
  beamId: number,
  values: Omit<OpenFem3DMemberPointLoad, "id" | "beamId" | "caseId">,
  caseId?: number,
): OpenFem3DModel {
  const previous = model.memberPointLoads ?? [];
  const id = nextEntityId(previous);
  const load = readMemberPointLoad(
    { ...values, ...(caseId !== undefined ? { caseId } : {}) } as unknown as Record<string, unknown>,
    model, id, beamId,
  );
  return { ...model, memberPointLoads: [...previous, load] };
}

export function updateOpenFem3DMemberPointLoad(
  model: OpenFem3DModel,
  loadId: number,
  values: Omit<OpenFem3DMemberPointLoad, "id" | "beamId" | "caseId">,
): OpenFem3DModel {
  const previous = model.memberPointLoads ?? [];
  const old = previous.find((load) => load.id === loadId);
  if (!old) throw new Error(`3D-staafpuntlast ${loadId} bestaat niet.`);
  const load = readMemberPointLoad(
    { ...values, ...(old.caseId !== undefined ? { caseId: old.caseId } : {}) } as unknown as Record<string, unknown>,
    model, loadId, old.beamId,
  );
  return { ...model, memberPointLoads: previous.map((item) => item.id === loadId ? load : item) };
}

export function removeOpenFem3DMemberPointLoad(model: OpenFem3DModel, loadId: number): OpenFem3DModel {
  return { ...model, memberPointLoads: (model.memberPointLoads ?? []).filter((load) => load.id !== loadId) };
}

export function addOpenFem3DThermalLoad(
  model: OpenFem3DModel,
  beamId: number,
  values: Omit<OpenFem3DThermalLoad, "id" | "beamId" | "caseId">,
  caseId?: number,
): OpenFem3DModel {
  const previous = model.thermalLoads ?? [];
  const id = nextEntityId(previous);
  const load = readThermalLoad(
    { ...values, ...(caseId !== undefined ? { caseId } : {}) } as unknown as Record<string, unknown>,
    model, id, beamId,
  );
  return { ...model, thermalLoads: [...previous, load] };
}

export function updateOpenFem3DThermalLoad(
  model: OpenFem3DModel,
  loadId: number,
  values: Omit<OpenFem3DThermalLoad, "id" | "beamId" | "caseId">,
): OpenFem3DModel {
  const previous = model.thermalLoads ?? [];
  const old = previous.find((load) => load.id === loadId);
  if (!old) throw new Error(`3D-temperatuurbelasting ${loadId} bestaat niet.`);
  const load = readThermalLoad(
    { ...values, ...(old.caseId !== undefined ? { caseId: old.caseId } : {}) } as unknown as Record<string, unknown>,
    model, loadId, old.beamId,
  );
  return { ...model, thermalLoads: previous.map((item) => item.id === loadId ? load : item) };
}

export function removeOpenFem3DThermalLoad(model: OpenFem3DModel, loadId: number): OpenFem3DModel {
  return { ...model, thermalLoads: (model.thermalLoads ?? []).filter((load) => load.id !== loadId) };
}

// ── Knoop en staaf toevoegen en wijzigen (zuiver; de basis van de API) ────────

/** Binnen deze afstand per richting liggen twee 3D-knopen op dezelfde plek (m). */
const OPEN_FEM_3D_SAME_POSITION_M = 1e-6;

/** Wat een nieuwe staaf krijgt als niets anders is opgegeven; gelijk aan het tekengereedschap. */
export const OPEN_FEM_3D_DEFAULT_BEAM = { material: "S235", profileName: "IPE 200" } as const;

export interface OpenFem3DNodeInput {
  x: number;
  y: number;
  z: number;
  name?: string;
}

/** Wijziging van een knoop; `null` wist de naam. */
export interface OpenFem3DNodePatch {
  x?: number;
  y?: number;
  z?: number;
  name?: string | null;
}

export interface OpenFem3DBeamInput {
  startNodeId: number;
  endNodeId: number;
  profileName?: string;
  /** Eindprofiel van een verlopende staaf; gekeurd met `bepaalVerloop`. */
  profileNameEnd?: string;
  material?: string;
  rollAngleRad?: number;
  shearDeformation?: boolean;
  /** Ontbrekende vrijheidsgraden zijn vast (false). */
  releases?: Partial<OpenFem3DEndReleases>;
  tensionOnly?: boolean;
  /** Staaf op bedding; gekeurd met {@link readOpenFem3DBeamBedding}. */
  bedding?: OpenFem3DBeamBedding;
  name?: string;
  group?: string;
}

/** Wijziging van een staaf; `null` wist een optioneel veld (ook de bedding), `tensionOnly: false` wist trek-alleen. */
export interface OpenFem3DBeamPatch {
  startNodeId?: number;
  endNodeId?: number;
  profileName?: string | null;
  /** `null` of leeg maakt de staaf prismatisch. */
  profileNameEnd?: string | null;
  material?: string | null;
  rollAngleRad?: number | null;
  shearDeformation?: boolean;
  releases?: Partial<OpenFem3DEndReleases> | null;
  tensionOnly?: boolean;
  bedding?: OpenFem3DBeamBedding | null;
  name?: string | null;
  group?: string | null;
}

function readCoordinate(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} moet een eindig getal zijn.`);
  return value;
}

function nodeAtSamePosition(
  model: OpenFem3DModel, x: number, y: number, z: number, exceptId?: number,
): OpenFem3DNode | undefined {
  return model.nodes.find((node) => node.id !== exceptId
    && Math.abs(node.x - x) <= OPEN_FEM_3D_SAME_POSITION_M
    && Math.abs(node.y - y) <= OPEN_FEM_3D_SAME_POSITION_M
    && Math.abs(node.z - z) <= OPEN_FEM_3D_SAME_POSITION_M);
}

/** Het model moet daarna gewoon openen; anders is de bewerking geweigerd. */
function assertOpensAfterEdit(model: OpenFem3DModel): OpenFem3DModel {
  parseOpenFem3DModel(model);
  return model;
}

/** Een nieuwe 3D-knoop met het volgende vrije id. Een knoop op de plek van een bestaande wordt geweigerd. */
export function addOpenFem3DNode(
  model: OpenFem3DModel, input: OpenFem3DNodeInput,
): { model: OpenFem3DModel; node: OpenFem3DNode } {
  const x = readCoordinate(input.x, "x"), y = readCoordinate(input.y, "y"), z = readCoordinate(input.z, "z");
  const existing = nodeAtSamePosition(model, x, y, z);
  if (existing) throw new Error(`Op (${x}; ${y}; ${z}) m ligt al 3D-knoop ${existing.id}.`);
  const name = readOptionalName(input.name, "De 3D-knoop");
  const node: OpenFem3DNode = { id: nextEntityId(model.nodes), x, y, z, ...(name ? { name } : {}) };
  return { model: assertOpensAfterEdit({ ...model, nodes: [...model.nodes, node] }), node };
}

/** Een knoop verplaatsen of hernoemen; staven, platen, opleggingen en lasten blijven eraan hangen. */
export function updateOpenFem3DNode(model: OpenFem3DModel, nodeId: number, patch: OpenFem3DNodePatch): OpenFem3DModel {
  const node = model.nodes.find((item) => item.id === nodeId);
  if (!node) throw new Error(`3D-knoop ${nodeId} bestaat niet.`);
  const x = patch.x === undefined ? node.x : readCoordinate(patch.x, "x");
  const y = patch.y === undefined ? node.y : readCoordinate(patch.y, "y");
  const z = patch.z === undefined ? node.z : readCoordinate(patch.z, "z");
  if (node.levelId !== undefined && z !== node.z) {
    throw new Error(`3D-knoop ${nodeId} hangt aan een level; z volgt dat level. Ontkoppel de knoop eerst of wijzig het level.`);
  }
  const existing = nodeAtSamePosition(model, x, y, z, nodeId);
  if (existing) throw new Error(`Op (${x}; ${y}; ${z}) m ligt al 3D-knoop ${existing.id}.`);
  const { name: _name, ...rest } = node;
  const name = patch.name === undefined ? node.name : readOptionalName(patch.name, `3D-knoop ${nodeId}`);
  const next: OpenFem3DNode = { ...rest, x, y, z, ...(name ? { name } : {}) };
  return assertOpensAfterEdit({ ...model, nodes: model.nodes.map((item) => item.id === nodeId ? next : item) });
}

function connectingBeam(model: OpenFem3DModel, a: number, b: number, exceptId?: number): OpenFem3DBeam | undefined {
  return model.beams.find((beam) => beam.id !== exceptId
    && ((beam.startNodeId === a && beam.endNodeId === b) || (beam.startNodeId === b && beam.endNodeId === a)));
}

function readRequiredText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} mag niet leeg zijn.`);
  return value.trim();
}

/** De optionele velden van een staaf uit `patch` op `beam` toepassen. */
function withBeamFields(beam: OpenFem3DBeam, patch: OpenFem3DBeamPatch): OpenFem3DBeam {
  const label = `3D-staaf ${beam.id}`;
  const next: OpenFem3DBeam = { ...beam };
  const set = <K extends keyof OpenFem3DBeam>(key: K, value: OpenFem3DBeam[K] | undefined) => {
    if (value === undefined) delete next[key];
    else next[key] = value;
  };
  if (patch.profileName !== undefined) set("profileName", patch.profileName === null ? undefined : readRequiredText(patch.profileName, `Het profiel van ${label}`));
  if (patch.profileNameEnd !== undefined) {
    if (patch.profileNameEnd !== null && typeof patch.profileNameEnd !== "string") throw new Error(`Het eindprofiel van ${label} is ongeldig.`);
    set("profileNameEnd", patch.profileNameEnd?.trim() || undefined);
  }
  if (patch.material !== undefined) set("material", patch.material === null ? undefined : readRequiredText(patch.material, `Het materiaal van ${label}`));
  if (patch.rollAngleRad !== undefined) set("rollAngleRad", patch.rollAngleRad === null ? undefined : readCoordinate(patch.rollAngleRad, `De rolhoek van ${label}`));
  if (patch.shearDeformation !== undefined) {
    if (typeof patch.shearDeformation !== "boolean") throw new Error(`De afschuifvervorming van ${label} is ongeldig.`);
    set("shearDeformation", patch.shearDeformation ? true : undefined);
  }
  if (patch.releases !== undefined) set("releases", patch.releases === null ? undefined : readEndReleases(patch.releases));
  if (patch.tensionOnly !== undefined) set("tensionOnly", patch.tensionOnly ? true : undefined);
  if (patch.name !== undefined) set("name", readOptionalName(patch.name, label));
  if (patch.group !== undefined) set("group", readOptionalName(patch.group, label));
  // Verloop (issue #73): alleen gekeurd als profiel, eindprofiel of materiaal
  // verandert. Een begin of materiaal dat niet meer bij het eindprofiel past,
  // wordt geweigerd met de reden van `bepaalVerloop` — de staaf wordt nooit
  // stil prismatisch; wie dat wil, haalt het eindprofiel weg (null).
  const verloopGeraakt = patch.profileName !== undefined || patch.profileNameEnd !== undefined || patch.material !== undefined;
  if (verloopGeraakt && next.profileNameEnd !== undefined) {
    if (!next.profileName) throw new Error(`${label} heeft een eindprofiel maar geen beginprofiel.`);
    const verloop = openFem3DBeamVerloop(next);
    if (verloop.status === "fout") throw new Error(`${label}: ${verloop.reden}.`);
    if (verloop.status === "prismatisch") delete next.profileNameEnd;
  }
  return next;
}

/** Wat de profielkiezer teruggeeft (`ProfielKeuze`), zonder de React-module. */
export interface OpenFem3DProfileChoice {
  material: string;
  profile: string;
  /** Eindprofiel van een verlopende staaf; ontbreekt of leeg = prismatisch (een eerder eindprofiel valt weg). */
  profileEnd?: string;
  beton?: {
    korf: NonNullable<BeamCheckConfig["betonKorf"]>;
    milieuklasse: BeamCheckConfig["betonMilieuklasse"] | null;
    constructieklasse: BeamCheckConfig["betonConstructieklasse"] | null;
  };
}

/**
 * De keuze uit de profielkiezer op één of meer staven: materiaal, profiel en
 * het EINDprofiel (verlopend, issue #73) — een prismatische keuze haalt een
 * eerder eindprofiel weg. Bij beton gaan korf, milieuklasse en
 * constructieklasse in de toetsinstellingen, de rest daarvan blijft staan.
 * Een eindprofiel dat niet bij het begin past, wordt met de reden geweigerd.
 */
export function applyOpenFem3DProfileChoice(
  model: OpenFem3DModel, beamIds: readonly number[], choice: OpenFem3DProfileChoice,
): OpenFem3DModel {
  const ids = new Set(beamIds);
  const beams = model.beams.map((beam) => {
    if (!ids.has(beam.id)) return beam;
    const next = withBeamFields(beam, {
      material: choice.material,
      profileName: choice.profile,
      profileNameEnd: choice.profileEnd?.trim() ? choice.profileEnd : null,
    });
    if (choice.beton) {
      next.checkConfig = {
        ...(beam.checkConfig ?? {}),
        betonKorf: choice.beton.korf,
        betonMilieuklasse: choice.beton.milieuklasse ?? undefined,
        betonConstructieklasse: choice.beton.constructieklasse ?? undefined,
      };
    }
    return next;
  });
  return assertOpensAfterEdit({ ...model, beams });
}

/** Een nieuwe staaf tussen twee bestaande knopen, met het volgende vrije id. */
export function addOpenFem3DBeam(
  model: OpenFem3DModel, input: OpenFem3DBeamInput,
): { model: OpenFem3DModel; beam: OpenFem3DBeam } {
  const { startNodeId, endNodeId } = input;
  requireNode(model, startNodeId);
  requireNode(model, endNodeId);
  if (startNodeId === endNodeId) throw new Error("Een 3D-staaf moet twee verschillende knopen verbinden.");
  const existing = connectingBeam(model, startNodeId, endNodeId);
  if (existing) throw new Error(`Tussen 3D-knoop ${startNodeId} en ${endNodeId} ligt al 3D-staaf ${existing.id}.`);
  const base: OpenFem3DBeam = { id: nextEntityId(model.beams), startNodeId, endNodeId, ...OPEN_FEM_3D_DEFAULT_BEAM };
  const fields = withBeamFields(base, input);
  // Lengte en verder dezelfde regels als bij omhangen.
  setOpenFem3DBeamNodes({ ...model, beams: [...model.beams, fields] }, fields.id, startNodeId, endNodeId);
  // De bedding hangt af van de stand van de staaf (een verticale staaf alleen zijdelings).
  const added = input.bedding === undefined
    ? { ...model, beams: [...model.beams, fields] }
    : setOpenFem3DBeamBedding({ ...model, beams: [...model.beams, fields] }, [fields.id], input.bedding);
  const beam = added.beams[added.beams.length - 1]!;
  return { model: assertOpensAfterEdit(added), beam };
}

/** Eigenschappen of knopen van een staaf wijzigen; lasten, toetsinstellingen en scharnieren blijven. */
export function updateOpenFem3DBeam(model: OpenFem3DModel, beamId: number, patch: OpenFem3DBeamPatch): OpenFem3DModel {
  const beam = model.beams.find((item) => item.id === beamId);
  if (!beam) throw new Error(`3D-staaf ${beamId} bestaat niet.`);
  let next = model;
  const startNodeId = patch.startNodeId ?? beam.startNodeId;
  const endNodeId = patch.endNodeId ?? beam.endNodeId;
  if (startNodeId !== beam.startNodeId || endNodeId !== beam.endNodeId) {
    requireNode(model, startNodeId);
    requireNode(model, endNodeId);
    const existing = connectingBeam(model, startNodeId, endNodeId, beamId);
    if (existing) throw new Error(`Tussen 3D-knoop ${startNodeId} en ${endNodeId} ligt al 3D-staaf ${existing.id}.`);
    // Zonder de keuring van de bedding: die volgt hieronder, met een bedding
    // uit dezelfde wijziging (bijv. omhangen naar verticaal en de k weghalen).
    next = rehangOpenFem3DBeam(model, beamId, startNodeId, endNodeId);
  }
  const updated = withBeamFields(next.beams.find((item) => item.id === beamId)!, patch);
  next = { ...next, beams: next.beams.map((item) => item.id === beamId ? updated : item) };
  // De bedding na het omhangen: ze wordt gekeurd tegen de nieuwe stand van de staaf.
  if (patch.bedding !== undefined) next = setOpenFem3DBeamBedding(next, [beamId], patch.bedding);
  return assertOpensAfterEdit(next);
}

/**
 * Reconnect a member while preserving its loads, section, releases and checks.
 * Een staaf op een verticale bedding (k) die daardoor (bijna) verticaal komt
 * te staan, wordt geweigerd ({@link OpenFem3DBeddingVerticalError}).
 */
export function setOpenFem3DBeamNodes(
  model: OpenFem3DModel,
  beamId: number,
  startNodeId: number,
  endNodeId: number,
): OpenFem3DModel {
  const next = rehangOpenFem3DBeam(model, beamId, startNodeId, endNodeId);
  // Een staaf op een verticale bedding mag niet verticaal komen te staan (#106).
  assertOpenFem3DBeddingFitsGeometry(next, [beamId]);
  return next;
}

/** Omhangen zonder de keuring van de bedding (die doet de aanroeper). */
function rehangOpenFem3DBeam(
  model: OpenFem3DModel,
  beamId: number,
  startNodeId: number,
  endNodeId: number,
): OpenFem3DModel {
  const beam = model.beams.find((item) => item.id === beamId);
  if (!beam) throw new Error(`3D-staaf ${beamId} bestaat niet.`);
  const start = model.nodes.find((node) => node.id === startNodeId);
  const end = model.nodes.find((node) => node.id === endNodeId);
  if (!start || !end) throw new Error("Begin- en eindknoop moeten bestaande 3D-knopen zijn.");
  if (startNodeId === endNodeId || (start.x === end.x && start.y === end.y && start.z === end.z)) {
    throw new Error("Een 3D-staaf moet twee verschillende knopen met een niet-nulle lengte verbinden.");
  }
  return {
    ...model,
    beams: model.beams.map((item) => item.id === beamId
      ? { ...item, startNodeId, endNodeId }
      : item),
  };
}

/**
 * De lokale dwarsassen van een staaf omkeren: de profielrotatie draait 180°.
 * De lokale belastingcomponenten draaien mee, zodat hun richting in het
 * wereldstelsel bij het omkeren van beide dwarsassen behouden blijft. Een
 * globale lijnlast (#80) hangt niet aan de lokale assen en blijft gelijk.
 */
export function flipOpenFem3DBeamLocalAxes(model: OpenFem3DModel, beamId: number): OpenFem3DModel {
  if (!model.beams.some((item) => item.id === beamId)) throw new Error(`3D-staaf ${beamId} bestaat niet.`);
  return {
    ...model,
    beams: model.beams.map((item) => item.id === beamId
      ? { ...item, rollAngleRad: ((item.rollAngleRad ?? 0) + Math.PI) % (2 * Math.PI) }
      : item),
    memberLoads: model.memberLoads?.map((load) => load.beamId === beamId && !isOpenFem3DGlobalMemberLoad(load)
      ? { ...load, qyStart: -load.qyStart, qyEnd: -load.qyEnd, qzStart: -load.qzStart, qzEnd: -load.qzEnd }
      : load),
    memberPointLoads: model.memberPointLoads?.map((load) => load.beamId === beamId
      ? { ...load, py: -load.py, pz: -load.pz } : load),
    thermalLoads: model.thermalLoads?.map((load) => load.beamId === beamId
      ? { ...load, deltaTGradientYK: -load.deltaTGradientYK, deltaTGradientZK: -load.deltaTGradientZK }
      : load),
  };
}

/** Standaardsituaties voor de eindscharnieren: de knoppen Momentvast en Scharnierend. */
export type OpenFem3DReleasePreset = "rigid" | "pinned";

export const OPEN_FEM_3D_RELEASE_PRESETS: Readonly<Record<OpenFem3DReleasePreset, Readonly<OpenFem3DEndReleases>>> = {
  // Momentvast: beide einden dragen alle momenten over.
  rigid: { myStart: false, myEnd: false, mzStart: false, mzEnd: false, torsionStart: false, torsionEnd: false },
  // Scharnierend: geen buigend moment aan de einden. Torsie gaat wel over;
  // los aan beide einden zou de staaf vrij om zijn eigen as laten draaien.
  pinned: { myStart: true, myEnd: true, mzStart: true, mzEnd: true, torsionStart: false, torsionEnd: false },
};

/** Welke standaardsituatie deze scharnieren zijn, of null als ze daar niet bij horen. */
export function openFem3DReleasePresetOf(releases: OpenFem3DEndReleases | undefined): OpenFem3DReleasePreset | null {
  const keys = Object.keys(OPEN_FEM_3D_RELEASE_PRESETS.rigid) as (keyof OpenFem3DEndReleases)[];
  for (const preset of ["rigid", "pinned"] as const) {
    if (keys.every((key) => (releases?.[key] ?? false) === OPEN_FEM_3D_RELEASE_PRESETS[preset][key])) return preset;
  }
  return null;
}

/**
 * Geef staven een standaardsituatie voor hun eindscharnieren. Momentvast haalt
 * het veld weg, zoals bij een staaf die nooit scharnieren had.
 */
export function setOpenFem3DReleasePreset(
  model: OpenFem3DModel,
  beamIds: readonly number[],
  preset: OpenFem3DReleasePreset,
): OpenFem3DModel {
  const ids = new Set(beamIds);
  for (const id of ids) {
    if (!model.beams.some((item) => item.id === id)) throw new Error(`3D-staaf ${id} bestaat niet.`);
  }
  return {
    ...model,
    beams: model.beams.map((item) => {
      if (!ids.has(item.id)) return item;
      const { releases: _oud, ...rest } = item;
      return preset === "rigid" ? rest : { ...rest, releases: { ...OPEN_FEM_3D_RELEASE_PRESETS.pinned } };
    }),
  };
}

/** Een staafeind: het begin (startNodeId) of het eind (endNodeId). */
export type OpenFem3DBeamEnd = "start" | "end";

const END_RELEASE_KEYS: Readonly<Record<OpenFem3DBeamEnd, {
  my: keyof OpenFem3DEndReleases; mz: keyof OpenFem3DEndReleases; torsion: keyof OpenFem3DEndReleases;
}>> = {
  start: { my: "myStart", mz: "mzStart", torsion: "torsionStart" },
  end: { my: "myEnd", mz: "mzEnd", torsion: "torsionEnd" },
};

/** Draagt dit staafeind een scharnier (My, Mz of T los)? Dan tekent het tekenvlak er een bolletje. */
export function openFem3DBeamEndHinged(beam: OpenFem3DBeam, end: OpenFem3DBeamEnd): boolean {
  const keys = END_RELEASE_KEYS[end];
  const releases = beam.releases;
  return releases !== undefined && (releases[keys.my] || releases[keys.mz] || releases[keys.torsion]);
}

/** Een staaf met nieuwe scharnieren; zonder één losse vrijheidsgraad verdwijnt het veld (zoals Momentvast). */
function withReleases(beam: OpenFem3DBeam, releases: OpenFem3DEndReleases): OpenFem3DBeam {
  const { releases: _oud, ...rest } = beam;
  return RELEASE_DOF.some((key) => releases[key]) ? { ...rest, releases } : rest;
}

/** Zet My en Mz aan één eind los (`true`) of vast (`false`); torsie blijft zoals hij is. */
function withEndHinge(beam: OpenFem3DBeam, end: OpenFem3DBeamEnd, hinged: boolean): OpenFem3DBeam {
  const keys = END_RELEASE_KEYS[end];
  return withReleases(beam, { ...RIGID_OPEN_FEM_3D_END, ...beam.releases, [keys.my]: hinged, [keys.mz]: hinged });
}

/** Staan My en Mz aan dit eind allebei los? */
function endFullyHinged(beam: OpenFem3DBeam, end: OpenFem3DBeamEnd): boolean {
  const keys = END_RELEASE_KEYS[end];
  return beam.releases?.[keys.my] === true && beam.releases?.[keys.mz] === true;
}

/**
 * Het gereedschap "Scharnier aan staafeind" en model3d.beam.setEndHinge: My en
 * Mz aan één eind van een staaf los, of weer vast. Zonder `hinged` wisselt de
 * klik: stonden My en Mz daar allebei al los, dan gaan ze vast, anders allebei
 * los (ook als alleen één van beide los stond). Torsie blijft zoals hij is.
 * Verandert er niets, dan komt hetzelfde model terug.
 */
export function setOpenFem3DBeamEndHinge(
  model: OpenFem3DModel,
  beamId: number,
  end: OpenFem3DBeamEnd,
  hinged?: boolean,
): { model: OpenFem3DModel; hinged: boolean } {
  const beam = model.beams.find((item) => item.id === beamId);
  if (!beam) throw new Error(`3D-staaf ${beamId} bestaat niet.`);
  const target = hinged ?? !endFullyHinged(beam, end);
  const keys = END_RELEASE_KEYS[end];
  const current = beam.releases;
  if ((current?.[keys.my] ?? false) === target && (current?.[keys.mz] ?? false) === target) return { model, hinged: target };
  const next = withEndHinge(beam, end, target);
  return { model: { ...model, beams: model.beams.map((item) => item.id === beamId ? next : item) }, hinged: target };
}

/** Een staaf is een kolom als zijn as bijna verticaal staat: |ex·Z| groter dan dit. */
export const OPEN_FEM_3D_COLUMN_COSINE = 0.95;

/** Staat de staaf bijna verticaal (|ex·Z| > 0,95)? Een staaf met een ontbrekende knoop of zonder lengte niet. */
export function openFem3DBeamIsColumn(
  beam: Pick<OpenFem3DBeam, "startNodeId" | "endNodeId">,
  nodesById: ReadonlyMap<number, Pick<OpenFem3DNode, "x" | "y" | "z">>,
): boolean {
  const a = nodesById.get(beam.startNodeId), b = nodesById.get(beam.endNodeId);
  if (!a || !b) return false;
  const length = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  return length > 0 && Math.abs(b.z - a.z) / length > OPEN_FEM_3D_COLUMN_COSINE;
}

// ── Staaf op bedding (issue #106) ──────────────────────────────────────────

/**
 * Boven deze |ex·Z| (steiler dan 45°) werkt een zijdelingse bedding rondom,
 * in twee richtingen loodrecht op de staafas, zoals bij een (schoor)paal;
 * daaronder horizontaal loodrecht op de staaf. Dezelfde grens als de kern.
 */
export const OPEN_FEM_3D_BEDDING_ALL_ROUND_COSINE = Math.SQRT1_2;

/** Werkt een zijdelingse bedding op deze staaf rondom (|ex·Z| > 1/√2)? Zonder knoop of lengte niet. */
export function openFem3DBeddingAllRound(
  beam: Pick<OpenFem3DBeam, "startNodeId" | "endNodeId">,
  nodesById: ReadonlyMap<number, Pick<OpenFem3DNode, "x" | "y" | "z">>,
): boolean {
  const a = nodesById.get(beam.startNodeId), b = nodesById.get(beam.endNodeId);
  if (!a || !b) return false;
  const length = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  return length > 0 && Math.abs(b.z - a.z) / length > OPEN_FEM_3D_BEDDING_ALL_ROUND_COSINE;
}

/**
 * Een bewerking van de geometrie (knoop verplaatsen, draaien, spiegelen,
 * omhangen) zou een staaf met een verticale bedding (k) (bijna) verticaal
 * zetten. Dat kan niet (zie {@link readOpenFem3DBeamBedding}); de bewerking
 * wordt geweigerd. `beamId` is de eerste staaf waarvoor dat geldt.
 */
export class OpenFem3DBeddingVerticalError extends Error {
  constructor(readonly beamId: number) {
    super(`3D-staaf ${beamId} komt dan (bijna) verticaal te staan en ligt op een verticale bedding (k): daar kan geen verticale bedding onder. `
      + "Haal eerst de verticale k weg (alleen zijdelings, zoals bij een paal) of haal de bedding weg.");
    this.name = "OpenFem3DBeddingVerticalError";
  }
}

/**
 * Keur na een bewerking van de geometrie of geen staaf met een verticale
 * bedding (k) (bijna) verticaal staat; zo niet, dan een
 * {@link OpenFem3DBeddingVerticalError}. `beamIds` beperkt de keuring tot die
 * staven (bijvoorbeeld de omgehangen staaf); zonder: alle staven.
 */
export function assertOpenFem3DBeddingFitsGeometry(
  model: Pick<OpenFem3DModel, "nodes" | "beams">,
  beamIds?: Iterable<number>,
): void {
  const ids = beamIds === undefined ? null : new Set(beamIds);
  const beams = model.beams.filter((beam) => beam.bedding?.kKnPerM3 !== undefined && (ids === null || ids.has(beam.id)));
  if (beams.length === 0) return;
  const nodes = new Map(model.nodes.map((node) => [node.id, node]));
  const fout = beams.find((beam) => openFem3DBeamIsColumn(beam, nodes));
  if (fout) throw new OpenFem3DBeddingVerticalError(fout.id);
}

/** De velden van een bedding; een ander veld is een tikfout en wordt geweigerd. */
const BEDDING_KEYS = ["kKnPerM3", "widthM", "kLateralKnPerM3", "compressionOnly"] as const;

/**
 * Keur een bedding van de staaf van `start` naar `end` en geef haar in vaste
 * vorm terug: constanten en breedte eindige getallen groter dan 0, minstens
 * één constante, "alleen druk" alleen bij een verticale k (en alleen `true`
 * bewaard). Een (bijna) verticale staaf (|ex·Z| > 0,95, net als de kern) kan
 * geen verticale k krijgen: daar alleen de zijdelingse bedding van een paal.
 * Dezelfde regels als de rekenkern, met een Nederlandse melding vooraf.
 */
export function readOpenFem3DBeamBedding(
  value: unknown,
  start: Pick<OpenFem3DNode, "x" | "y" | "z">,
  end: Pick<OpenFem3DNode, "x" | "y" | "z">,
  label: string,
): OpenFem3DBeamBedding {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}: de bedding moet een object zijn met k (kKnPerM3) en de contactbreedte (widthM).`);
  }
  const raw = value as Record<string, unknown>;
  const onbekend = Object.keys(raw).filter((key) => raw[key] !== undefined && !(BEDDING_KEYS as readonly string[]).includes(key));
  if (onbekend.length > 0) {
    throw new Error(`${label}: onbekend veld in de bedding: ${onbekend.join(", ")}. Toegestaan: ${BEDDING_KEYS.join(", ")}.`);
  }
  const positief = (key: "kKnPerM3" | "widthM" | "kLateralKnPerM3", wat: string): number | undefined => {
    const getal = raw[key];
    if (getal === undefined || getal === null) return undefined;
    if (typeof getal !== "number" || !Number.isFinite(getal) || getal <= 0) {
      throw new Error(`${label}: ${wat} moet een eindig getal groter dan 0 zijn.`);
    }
    return getal;
  };
  const kKnPerM3 = positief("kKnPerM3", "de beddingsconstante k (kN/m³)");
  const widthM = positief("widthM", "de contactbreedte b (m)");
  const kLateralKnPerM3 = positief("kLateralKnPerM3", "de zijdelingse beddingsconstante (kN/m³)");
  if (widthM === undefined) throw new Error(`${label}: de bedding mist de contactbreedte b (widthM, in m).`);
  if (raw.compressionOnly !== undefined && typeof raw.compressionOnly !== "boolean") {
    throw new Error(`${label}: "alleen druk" (compressionOnly) moet true of false zijn.`);
  }
  if (kKnPerM3 === undefined && kLateralKnPerM3 === undefined) {
    throw new Error(`${label}: geef een beddingsconstante: k voor de verticale richting of de zijdelingse k.`);
  }
  if (kKnPerM3 !== undefined && openFem3DBeamIsColumn(
    { startNodeId: 1, endNodeId: 2 }, new Map([[1, start], [2, end]]),
  )) {
    throw new Error(`${label} staat (bijna) verticaal: daar kan geen verticale bedding (k) onder. `
      + "Geef alleen een zijdelingse bedding (kLateralKnPerM3), zoals bij een paal in de grond; die werkt rondom, loodrecht op de paal.");
  }
  if (raw.compressionOnly === true && kKnPerM3 === undefined) {
    throw new Error(`${label}: "alleen druk" geldt voor de verticale bedding, en deze bedding heeft geen verticale k.`);
  }
  return {
    ...(kKnPerM3 !== undefined ? { kKnPerM3 } : {}),
    widthM,
    ...(kLateralKnPerM3 !== undefined ? { kLateralKnPerM3 } : {}),
    ...(raw.compressionOnly === true ? { compressionOnly: true } : {}),
  };
}

/** De melding als een staaf zowel trek-alleen als op bedding zou zijn (dezelfde regel als de rekenkern). */
export function beddingTrekAlleenMelding(beamId: number): string {
  return `3D-staaf ${beamId} is trek-alleen en kan niet op bedding liggen: een trek-alleen staaf valt op druk weg en zou de grond loslaten. Zet eerst trek-alleen uit.`;
}

const sameBedding = (a: OpenFem3DBeamBedding | undefined, b: OpenFem3DBeamBedding | undefined) =>
  a === b || (a !== undefined && b !== undefined && BEDDING_KEYS.every((key) => a[key] === b[key]));

/**
 * Zet dezelfde bedding op de staven `beamIds`, of haal haar weg (`null`). Eén
 * modelwijziging, dus één stap ongedaan maken; dezelfde functie voor het
 * eigenschappenpaneel en de API. Elke staaf wordt gekeurd met
 * {@link readOpenFem3DBeamBedding} (een verticale staaf weigert een verticale
 * k). Verandert er niets, dan komt hetzelfde model terug.
 */
export function setOpenFem3DBeamBedding(
  model: OpenFem3DModel,
  beamIds: readonly number[],
  bedding: OpenFem3DBeamBedding | null,
): OpenFem3DModel {
  const ids = new Set(beamIds);
  for (const id of ids) {
    if (!model.beams.some((beam) => beam.id === id)) throw new Error(`3D-staaf ${id} bestaat niet.`);
  }
  const nodes = new Map(model.nodes.map((node) => [node.id, node]));
  let changed = false;
  const beams = model.beams.map((beam) => {
    if (!ids.has(beam.id)) return beam;
    const { bedding: _oud, ...rest } = beam;
    let next: OpenFem3DBeamBedding | undefined;
    if (bedding !== null) {
      if (beam.tensionOnly) throw new Error(beddingTrekAlleenMelding(beam.id));
      const start = nodes.get(beam.startNodeId), end = nodes.get(beam.endNodeId);
      if (!start || !end) throw new Error(`3D-staaf ${beam.id} verwijst naar een ontbrekende knoop.`);
      next = readOpenFem3DBeamBedding(bedding, start, end, `3D-staaf ${beam.id}`);
    }
    if (sameBedding(beam.bedding, next)) return beam;
    changed = true;
    return next === undefined ? rest : { ...rest, bedding: next };
  });
  return changed ? { ...model, beams } : model;
}

// ── Plaat op bedding (issue #107) ──────────────────────────────────────────

/** De velden van een plaatbedding; een ander veld is een tikfout en wordt geweigerd. */
const PLATE_BEDDING_KEYS = ["kKnPerM3", "compressionOnly"] as const;

/**
 * Keur een plaatbedding en geef haar in vaste vorm terug: k een eindig getal
 * groter dan 0 (kN/m³), "alleen druk" true of false (alleen `true` bewaard),
 * geen ander veld (ook niet de breedte van de staafbedding: een plaat draagt
 * over haar eigen oppervlak). Dezelfde regels als de rekenkern, met een
 * Nederlandse melding vooraf.
 */
export function readOpenFem3DPlateBedding(value: unknown, label: string): OpenFem3DPlateBedding {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}: de bedding moet een object zijn met de beddingsconstante k (kKnPerM3).`);
  }
  const raw = value as Record<string, unknown>;
  const onbekend = Object.keys(raw).filter((key) => raw[key] !== undefined && !(PLATE_BEDDING_KEYS as readonly string[]).includes(key));
  if (onbekend.length > 0) {
    throw new Error(`${label}: onbekend veld in de bedding: ${onbekend.join(", ")}. Toegestaan: ${PLATE_BEDDING_KEYS.join(", ")}.`);
  }
  if (raw.kKnPerM3 === undefined || raw.kKnPerM3 === null) {
    throw new Error(`${label}: de bedding mist de beddingsconstante k (kKnPerM3, in kN/m³).`);
  }
  if (typeof raw.kKnPerM3 !== "number" || !Number.isFinite(raw.kKnPerM3) || raw.kKnPerM3 <= 0) {
    throw new Error(`${label}: de beddingsconstante k (kN/m³) moet een eindig getal groter dan 0 zijn.`);
  }
  if (raw.compressionOnly !== undefined && typeof raw.compressionOnly !== "boolean") {
    throw new Error(`${label}: "alleen druk" (compressionOnly) moet true of false zijn.`);
  }
  return { kKnPerM3: raw.kKnPerM3, ...(raw.compressionOnly === true ? { compressionOnly: true } : {}) };
}

const samePlateBedding = (a: OpenFem3DPlateBedding | undefined, b: OpenFem3DPlateBedding | undefined) =>
  a === b || (a !== undefined && b !== undefined && PLATE_BEDDING_KEYS.every((key) => a[key] === b[key]));

/**
 * Zet dezelfde bedding op de platen `plateIds`, of haal haar weg (`null`).
 * Eén modelwijziging, dus één stap ongedaan maken; dezelfde functie voor het
 * eigenschappenpaneel en de API. Gekeurd met {@link readOpenFem3DPlateBedding}.
 * Verandert er niets, dan komt hetzelfde model terug.
 */
export function setOpenFem3DPlateBedding(
  model: OpenFem3DModel,
  plateIds: readonly number[],
  bedding: OpenFem3DPlateBedding | null,
): OpenFem3DModel {
  const ids = new Set(plateIds);
  for (const id of ids) {
    if (!(model.plates ?? []).some((plate) => plate.id === id)) throw new Error(`3D-plaat ${id} bestaat niet.`);
  }
  let changed = false;
  const plates = (model.plates ?? []).map((plate) => {
    if (!ids.has(plate.id)) return plate;
    const { bedding: _oud, ...rest } = plate;
    const next = bedding === null ? undefined : readOpenFem3DPlateBedding(bedding, `3D-plaat ${plate.id}`);
    if (samePlateBedding(plate.bedding, next)) return plate;
    changed = true;
    return next === undefined ? rest : { ...rest, bedding: next };
  });
  return changed ? { ...model, plates } : model;
}

/**
 * Waarom "Liggers scharnierend" een liggereind bij een kolom momentvast liet:
 *  - "cantilever": het deel aan de andere kant van de ligger hangt alleen aan
 *    deze kolomknoop (een uitkraging, dakoverstek of luifel, ook als die uit
 *    meer staven bestaat); met een scharnier daar draait het vrij om de knoop;
 *  - "hingeLine": dat deel zou alleen nog aan scharnieren op één rechte lijn
 *    hangen, zonder een staaf langs die lijn die de torsie overdraagt (bijv.
 *    twee uitkragingen met een randligger ertussen); het draait dan om die
 *    lijn.
 */
export type OpenFem3DPinSkipReason = "cantilever" | "hingeLine";

export interface OpenFem3DPinToColumnsResult {
  model: OpenFem3DModel;
  /** De staafeinden die My en Mz los kregen. */
  changed: { beamId: number; end: OpenFem3DBeamEnd }[];
  /** Liggereinden op een kolomkop die momentvast bleven, omdat er met een scharnier een mechanisme zou ontstaan. */
  skipped: { beamId: number; end: OpenFem3DBeamEnd; reason: OpenFem3DPinSkipReason }[];
}

const RESTRAINT_DOF = ["ux", "uy", "uz", "rx", "ry", "rz"] as const;

/** Houdt deze oplegging de knoop ergens vast (een geblokkeerde richting of een veer)? */
function supportHolds(support: OpenFem3DSupport): boolean {
  return RESTRAINT_DOF.some((dof) => support[dof])
    || Object.values(support.springs ?? {}).some((value) => typeof value === "number" && value > 0);
}

/**
 * De opdracht "Liggers scharnierend op kolommen" en model3d.beam.pinToColumns.
 * Elk eind van een ligger (een staaf die niet bijna verticaal staat; een
 * schuine spant telt dus mee) op een kolomkop krijgt My en Mz los. De kolommen
 * zelf blijven doorgaand; torsie blijft zoals hij is.
 *
 * Een kolomkop is het BOVENSTE eind van een kolom (|ex·Z| > 0,95) die naar
 * beneden ergens op steunt: via staven en platen, zonder langs haar eigen kop,
 * bij een oplegging of veer. Het onderste eind telt niet: een balkrooster
 * onder een kolomvoet of poer en een ligger waar een kolom op staat, blijven
 * doorgaand. Een kolom die in stukken is geknipt, telt op elke tussenknoop
 * (daar heeft het onderste stuk zijn kop). Een hangstaaf onder een ligger
 * telt niet. Heeft het model nog geen enkele oplegging of veer, dan telt elke
 * kolom.
 *
 * Vóór het losmaken kijkt de opdracht of het deel achter elke ligger daarna
 * nog vastzit. Dat deel is alles wat vanaf het andere eind bereikbaar is
 * zonder over een kolomkop te gaan. Het zit vast als het een oplegging of
 * veer heeft, momentvast aan een kolomkop hangt (een kolom, plaat of ligger
 * zonder scharnier daar), of aan scharnieren op ten minste drie kolomkoppen
 * die niet op één lijn liggen. Hangt het aan koppen op één lijn, dan moet een
 * staaf langs die lijn de torsie overdragen (zoals een ligger in stukken
 * tussen twee kolommen). Anders blijven de einden van dat deel momentvast en
 * staan ze in `skipped` (zie {@link OpenFem3DPinSkipReason}). Een ligger van
 * kolomkop tot kolomkop heeft geen deel achter zich en gaat altijd los.
 *
 * `beamIds` beperkt het tot die staven (een kolom ertussen wordt
 * overgeslagen); zonder `beamIds` gaat het om alle staven. `changed` noemt de
 * staafeinden die veranderden; zonder verandering komt hetzelfde model terug.
 */
export function pinOpenFem3DBeamsToColumns(
  model: OpenFem3DModel,
  beamIds?: readonly number[],
): OpenFem3DPinToColumnsResult {
  const wanted = beamIds === undefined ? null : new Set(beamIds);
  if (wanted) {
    for (const id of wanted) {
      if (!model.beams.some((item) => item.id === id)) throw new Error(`3D-staaf ${id} bestaat niet.`);
    }
  }
  const nodesById = new Map(model.nodes.map((node) => [node.id, node]));
  const validBeam = (beam: OpenFem3DBeam) =>
    beam.startNodeId !== beam.endNodeId && nodesById.has(beam.startNodeId) && nodesById.has(beam.endNodeId);
  const plateNodes = (model.plates ?? []).map((plate) =>
    [...new Set([...plate.nodeIds, ...(plate.openings ?? []).flatMap((opening) => opening.nodeIds)])]
      .filter((id) => nodesById.has(id)));

  // Verbindingen: een staaf koppelt zijn twee knopen, een plaat al haar knopen.
  const neighbours = new Map<number, number[]>();
  const link = (a: number, b: number) => {
    if (a === b) return;
    for (const [from, to] of [[a, b], [b, a]] as const) {
      let list = neighbours.get(from);
      if (!list) neighbours.set(from, list = []);
      list.push(to);
    }
  };
  for (const beam of model.beams) if (validBeam(beam)) link(beam.startNodeId, beam.endNodeId);
  for (const ids of plateNodes) for (let index = 1; index < ids.length; index += 1) link(ids[0]!, ids[index]!);

  // Vastgehouden knopen: een oplegging of veer, of een plaat met een randoplegging.
  const held = new Set<number>();
  for (const support of model.supports ?? []) if (supportHolds(support)) held.add(support.nodeId);
  (model.plates ?? []).forEach((plate, index) => {
    if ((plate.edgeSupports ?? []).some((edge) => RESTRAINT_DOF.some((dof) => edge[dof]))) {
      for (const id of plateNodes[index]!) held.add(id);
    }
  });

  /** Bereikt een zoektocht vanaf `start`, zonder over `blocked` te gaan, een vastgehouden knoop? */
  const reachesHeld = (start: number, blocked: number) => {
    const seen = new Set([start, blocked]);
    const queue = [start];
    for (let index = 0; index < queue.length; index += 1) {
      const id = queue[index]!;
      if (held.has(id)) return true;
      for (const next of neighbours.get(id) ?? []) {
        if (!seen.has(next)) { seen.add(next); queue.push(next); }
      }
    }
    return false;
  };

  // De kolommen en hun koppen.
  const columns = new Set<number>();
  const tops = new Set<number>();
  for (const beam of model.beams) {
    if (!openFem3DBeamIsColumn(beam, nodesById)) continue;
    columns.add(beam.id);
    const a = nodesById.get(beam.startNodeId)!, b = nodesById.get(beam.endNodeId)!;
    const [bottom, top] = a.z <= b.z ? [a.id, b.id] : [b.id, a.id];
    if (!tops.has(top) && (held.size === 0 || reachesHeld(bottom, top))) tops.add(top);
  }

  // De kandidaten: liggereinden op een kolomkop die nog niet helemaal los zijn.
  type Candidate = { beam: OpenFem3DBeam; end: OpenFem3DBeamEnd; other: number };
  const candidates: Candidate[] = [];
  const isCandidate = new Set<string>();
  for (const beam of model.beams) {
    if (columns.has(beam.id) || (wanted && !wanted.has(beam.id)) || !validBeam(beam)) continue;
    for (const end of ["start", "end"] as const) {
      const nodeId = end === "start" ? beam.startNodeId : beam.endNodeId;
      if (!tops.has(nodeId) || endFullyHinged(beam, end)) continue;
      candidates.push({ beam, end, other: end === "start" ? beam.endNodeId : beam.startNodeId });
      isCandidate.add(`${beam.id}:${end}`);
    }
  }

  // De delen achter de kolomkoppen: samenhangende groepen knopen zonder kolomkop.
  const part = new Map<number, number>();
  let parts = 0;
  for (const node of model.nodes) {
    if (tops.has(node.id) || part.has(node.id)) continue;
    part.set(node.id, parts);
    const queue = [node.id];
    for (let index = 0; index < queue.length; index += 1) {
      for (const next of neighbours.get(queue[index]!) ?? []) {
        if (!tops.has(next) && !part.has(next)) { part.set(next, parts); queue.push(next); }
      }
    }
    parts += 1;
  }
  /** Hangt dit eind na de opdracht scharnierend aan zijn knoop (My of Mz los)? */
  const hingedAfter = (beam: OpenFem3DBeam, end: OpenFem3DBeamEnd) => {
    const keys = END_RELEASE_KEYS[end];
    return isCandidate.has(`${beam.id}:${end}`) || beam.releases?.[keys.my] === true || beam.releases?.[keys.mz] === true;
  };
  /** Een scharnierende aansluiting op een kolomkop: de kop, de richting van de staaf vanaf de kop, en of hij torsie overdraagt. */
  type Hinge = { top: number; direction: readonly [number, number, number]; carriesTorsion: boolean };
  const hingeAt = (beam: OpenFem3DBeam, topEnd: OpenFem3DBeamEnd): Hinge => {
    const top = nodesById.get(topEnd === "start" ? beam.startNodeId : beam.endNodeId)!;
    const other = nodesById.get(topEnd === "start" ? beam.endNodeId : beam.startNodeId)!;
    const length = Math.hypot(other.x - top.x, other.y - top.y, other.z - top.z);
    return {
      top: top.id,
      direction: [(other.x - top.x) / length, (other.y - top.y) / length, (other.z - top.z) / length],
      carriesTorsion: !beam.releases?.torsionStart && !beam.releases?.torsionEnd,
    };
  };
  const hingesOf = new Map<number, Hinge[]>();
  const steady = new Set<number>();
  for (const id of held) if (part.has(id)) steady.add(part.get(id)!);
  for (const beam of model.beams) {
    if (!validBeam(beam)) continue;
    const startPart = part.get(beam.startNodeId), endPart = part.get(beam.endNodeId);
    // Precies één eind in een deel, het andere op een kolomkop.
    if ((startPart === undefined) === (endPart === undefined)) continue;
    const topEnd: OpenFem3DBeamEnd = startPart === undefined ? "start" : "end";
    const partId = (startPart ?? endPart)!;
    if (!hingedAfter(beam, topEnd)) { steady.add(partId); continue; }
    let list = hingesOf.get(partId);
    if (!list) hingesOf.set(partId, list = []);
    list.push(hingeAt(beam, topEnd));
  }
  for (const ids of plateNodes) {
    if (!ids.some((id) => tops.has(id))) continue;
    for (const id of ids) if (part.has(id)) steady.add(part.get(id)!);
  }

  /** Zit iets dat alleen aan deze scharnieren op kolomkoppen hangt, daarna nog vast? */
  const verdictOf = (hinges: readonly Hinge[]): OpenFem3DPinSkipReason | null => {
    const points = [...new Set(hinges.map((hinge) => hinge.top))].map((id) => nodesById.get(id)!);
    if (points.length <= 1) return "cantilever";
    // De twee verst uit elkaar liggende koppen spannen de lijn op.
    let a = points[0]!, b = points[1]!, longest = -1;
    for (const p of points) for (const q of points) {
      const distance = Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z);
      if (distance > longest) { longest = distance; a = p; b = q; }
    }
    const axis = [(b.x - a.x) / longest, (b.y - a.y) / longest, (b.z - a.z) / longest] as const;
    const offLine = points.some((p) => {
      const v = [p.x - a.x, p.y - a.y, p.z - a.z] as const;
      const along = v[0] * axis[0] + v[1] * axis[1] + v[2] * axis[2];
      return Math.hypot(v[0] - along * axis[0], v[1] - along * axis[1], v[2] - along * axis[2]) > 1e-6 * Math.max(1, longest);
    });
    if (offLine) return null;
    const torsionAlongLine = hinges.some((hinge) => hinge.carriesTorsion
      && Math.abs(hinge.direction[0] * axis[0] + hinge.direction[1] * axis[1] + hinge.direction[2] * axis[2]) > 1 - 1e-6);
    return torsionAlongLine ? null : "hingeLine";
  };
  const partVerdicts = new Map<number, OpenFem3DPinSkipReason | null>();
  const verdictFor = (candidate: Candidate): OpenFem3DPinSkipReason | null => {
    const partId = part.get(candidate.other);
    // Een ligger tussen twee kolomkoppen: er hangt niets achter, en de koppen
    // zelf staan op hun kolommen. Ook met torsie los blijft hij een pendelstaaf.
    if (partId === undefined) return null;
    if (steady.has(partId)) return null;
    if (!partVerdicts.has(partId)) partVerdicts.set(partId, verdictOf(hingesOf.get(partId) ?? []));
    return partVerdicts.get(partId)!;
  };

  const changed: OpenFem3DPinToColumnsResult["changed"] = [];
  const skipped: OpenFem3DPinToColumnsResult["skipped"] = [];
  const nextById = new Map<number, OpenFem3DBeam>();
  for (const candidate of candidates) {
    const reason = verdictFor(candidate);
    if (reason) {
      skipped.push({ beamId: candidate.beam.id, end: candidate.end, reason });
      continue;
    }
    nextById.set(candidate.beam.id, withEndHinge(nextById.get(candidate.beam.id) ?? candidate.beam, candidate.end, true));
    changed.push({ beamId: candidate.beam.id, end: candidate.end });
  }
  if (changed.length === 0) return { model, changed, skipped };
  return { model: { ...model, beams: model.beams.map((beam) => nextById.get(beam.id) ?? beam) }, changed, skipped };
}

/**
 * Voor welke staven "Liggers scharnierend" in het lint werkt: de
 * geselecteerde staven (die bestaan, zonder dubbele), of `undefined` (alle
 * staven) als er geen staaf geselecteerd is, ook als er alleen knopen of
 * platen geselecteerd zijn.
 */
export function openFem3DPinToColumnsScope(
  model: Pick<OpenFem3DModel, "beams">,
  selection: OpenFem3DSelection,
): number[] | undefined {
  const selected = selection?.type === "beam" ? [selection.id] : selection?.type === "multi" ? selection.beamIds : [];
  const existing = new Set(model.beams.map((beam) => beam.id));
  const ids = [...new Set(selected)].filter((id) => existing.has(id));
  return ids.length > 0 ? ids : undefined;
}

/** Een regel van een melding: een i18n-sleutel, met het aantal als die er een heeft. */
export interface OpenFem3DMessagePart {
  key: string;
  count?: number;
}

/**
 * De melding na "Liggers scharnierend": hoeveel staafeinden scharnierend zijn
 * gemaakt (of dat er niets veranderde), binnen de selectie of in het hele
 * model, en hoeveel liggereinden momentvast bleven omdat er anders een
 * mechanisme ontstaat.
 */
export function openFem3DPinToColumnsMessage(
  result: Pick<OpenFem3DPinToColumnsResult, "changed" | "skipped">,
  scope: readonly number[] | undefined,
): { level: "success" | "info"; title: OpenFem3DMessagePart; details: OpenFem3DMessagePart[] } {
  const details: OpenFem3DMessagePart[] = [scope
    ? { key: "ribbon:openFem3d.pinBeamsToColumnsScopeSelection", count: scope.length }
    : { key: "ribbon:openFem3d.pinBeamsToColumnsScopeAll" }];
  if (result.skipped.length > 0) details.push({ key: "ribbon:openFem3d.pinBeamsToColumnsSkipped", count: result.skipped.length });
  return result.changed.length > 0
    ? { level: "success", title: { key: "ribbon:openFem3d.pinBeamsToColumnsDone", count: result.changed.length }, details }
    : { level: "info", title: { key: "ribbon:openFem3d.pinBeamsToColumnsNone" }, details };
}

export interface OpenFem3DBeamSplitResult {
  model: OpenFem3DModel;
  nodeId: number;
  firstBeamId: number;
  secondBeamId: number;
}

const RIGID_OPEN_FEM_3D_END: OpenFem3DEndReleases = {
  myStart: false, myEnd: false,
  mzStart: false, mzEnd: false,
  torsionStart: false, torsionEnd: false,
};

/**
 * Knip een staaf op een relatieve positie. De oorspronkelijke staaf-id blijft
 * bij het eerste deel, zodat verwijzingen zo stabiel mogelijk blijven.
 *
 * Lokale staaflasten behouden hun resulterende: trapeziumlasten worden op het
 * knippunt geïnterpoleerd, puntlasten worden naar het juiste kind verplaatst
 * en temperatuurbelasting geldt voor beide delen. Alleen de oorspronkelijke
 * buitenste eindvrijgaven blijven bestaan; de nieuwe tussenknoop is star.
 *
 * Met `options.nodeId` wordt geknipt op die bestaande knoop (knopen op staven
 * aansluiten, issue #63): `ratio` is dan zijn projectie op de staafas. Ligt de
 * knoop net naast de as (binnen de verbindingstolerantie), dan wordt hij niet
 * verschoven; beide delen lopen naar de knoop en zijn daardoor een fractie
 * langer dan ratio·L en (1 − ratio)·L. De lastposities schalen per deel mee,
 * zodat een last die tot het knippunt of het staafeind liep dat nog steeds
 * doet; de intensiteiten (per meter) blijven gelijk.
 *
 * Een lastgrens binnen de afrondingsruis van het knippunt (1e-9·L) telt als
 * op het knippunt: de last gaat geheel naar één deel, zonder snipper van
 * ~1e-16 m aan de andere kant en zonder last van lengte 0.
 *
 * Een verlopende stalen staaf (#73) krijgt op de knip een gelaste
 * tussendoorsnede, die standaard in de bibliotheek met eigen doorsneden wordt
 * bewaard (zoals in 2D). Met `options.bewaarTussendoorsnede: false` gebeurt
 * dat niet: voor een proefknip (de modelcontrole), die het model weer
 * weggooit en de bibliotheek dus niet mag vullen.
 */
export function splitOpenFem3DBeam(
  model: OpenFem3DModel,
  beamId: number,
  ratio: number,
  options: { nodeId?: number; bewaarTussendoorsnede?: boolean } = {},
): OpenFem3DBeamSplitResult {
  const beam = model.beams.find((item) => item.id === beamId);
  if (!beam) throw new Error(`3D-staaf ${beamId} bestaat niet.`);
  if (!Number.isFinite(ratio) || ratio <= 1e-6 || ratio >= 1 - 1e-6) {
    throw new Error("De subknoop moet binnen de 3D-staaf liggen.");
  }
  const start = model.nodes.find((node) => node.id === beam.startNodeId);
  const end = model.nodes.find((node) => node.id === beam.endNodeId);
  if (!start || !end) throw new Error("De 3D-staaf verwijst naar een ontbrekende knoop.");
  const length = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
  if (length <= 1e-12) throw new Error("Een 3D-staaf zonder lengte kan niet worden geknipt.");

  const splitPoint = {
    x: start.x + (end.x - start.x) * ratio,
    y: start.y + (end.y - start.y) * ratio,
    z: start.z + (end.z - start.z) * ratio,
  };
  const atNode = options.nodeId === undefined ? undefined : model.nodes.find((node) => node.id === options.nodeId);
  if (options.nodeId !== undefined) {
    if (!atNode) throw new Error(`3D-knoop ${options.nodeId} bestaat niet.`);
    if (atNode.id === start.id || atNode.id === end.id) throw new Error("De subknoop moet binnen de 3D-staaf liggen.");
  }
  const existingNode = atNode ?? model.nodes.find((node) =>
    node.id !== start.id && node.id !== end.id &&
    Math.hypot(node.x - splitPoint.x, node.y - splitPoint.y, node.z - splitPoint.z) <= 1e-8);
  const nodeId = existingNode?.id ?? nextEntityId(model.nodes);
  const secondBeamId = nextEntityId(model.beams);
  const duplicateSegment = model.beams.find((item) => item.id !== beamId && (
    (item.startNodeId === beam.startNodeId && item.endNodeId === nodeId) ||
    (item.startNodeId === nodeId && item.endNodeId === beam.startNodeId) ||
    (item.startNodeId === nodeId && item.endNodeId === beam.endNodeId) ||
    (item.startNodeId === beam.endNodeId && item.endNodeId === nodeId)
  ));
  if (duplicateSegment) {
    throw new Error(`Splitsen zou 3D-staaf ${duplicateSegment.id} verdubbelen.`);
  }

  const originalReleases = beam.releases;
  // Een verlopende staaf (#73) wordt twee verlopende staven met de
  // geïnterpoleerde doorsnede op de knip als eind van het eerste en begin van
  // het tweede deel, zoals in 2D (`splitsVerlopendProfiel`, dat een stalen
  // tussendoorsnede als eigen gelaste doorsnede bewaart). A(x) en I(x)
  // veranderen daardoor nergens; het letterlijk kopiëren van beide profielen
  // zou van één verloop twee volle verlopen maken. Een proefknip bewaart
  // niets (`bewaarTussendoorsnede: false`); de naam wordt wel tegen de
  // bibliotheek gekeurd, zodat een botsing ook in de proef een fout is.
  const tussenProfiel = beam.profileNameEnd === undefined
    ? null
    : options.bewaarTussendoorsnede === false
      ? tussenProfielVoorSplitsing(beam.material, beam.profileName, beam.profileNameEnd, ratio)?.tussenProfiel ?? null
      : splitsVerlopendProfiel(beam.material, beam.profileName, beam.profileNameEnd, ratio);
  const firstBeam: OpenFem3DBeam = {
    ...beam,
    ...(tussenProfiel !== null ? { profileNameEnd: tussenProfiel } : {}),
    endNodeId: nodeId,
    ...(originalReleases ? {
      releases: {
        ...RIGID_OPEN_FEM_3D_END,
        myStart: originalReleases.myStart,
        mzStart: originalReleases.mzStart,
        torsionStart: originalReleases.torsionStart,
      },
    } : {}),
  };
  const secondBeam: OpenFem3DBeam = {
    ...beam,
    ...(tussenProfiel !== null ? { profileName: tussenProfiel } : {}),
    id: secondBeamId,
    startNodeId: nodeId,
    ...(originalReleases ? {
      releases: {
        ...RIGID_OPEN_FEM_3D_END,
        myEnd: originalReleases.myEnd,
        mzEnd: originalReleases.mzEnd,
        torsionEnd: originalReleases.torsionEnd,
      },
    } : {}),
  };
  const beams = model.beams.flatMap((item) => item.id === beamId ? [firstBeam, secondBeam] : [item]);
  const splitDistance = ratio * length;
  // Een plek s langs de oorspronkelijke staaf op het eerste of tweede deel.
  // Zonder `atNode` precies s en s − knipafstand; op een knoop naast de as
  // geschaald naar de werkelijke deellengte (en daarbinnen gehouden).
  const firstLength = atNode ? Math.hypot(atNode.x - start.x, atNode.y - start.y, atNode.z - start.z) : splitDistance;
  const secondLength = atNode ? Math.hypot(end.x - atNode.x, end.y - atNode.y, end.z - atNode.z) : length - splitDistance;
  const onFirst = (s: number) => atNode ? Math.min(firstLength, s * firstLength / splitDistance) : s;
  const onSecond = (s: number) => atNode
    ? Math.min(secondLength, Math.max(0, (s - splitDistance) * secondLength / (length - splitDistance)))
    : s - splitDistance;
  // Een lastgrens ligt "op het knippunt" binnen de afrondingsruis van de
  // knipafstand. Een knooppositie in hele mm is binair niet exact (10,243 +
  // 7,6 geeft een knipafstand van 7,6000000000000005); een last die op 7,6
  // eindigt of begint, hoort dan toch bij de knoop. Zonder deze ruimte gaat
  // zo'n last als een snipper van ~1e-16 m over het knippunt, of komt hij na
  // het meeschalen op het eerste deel als [L, L] (lengte 0) terecht, en
  // weigeren opslaan en de kern het model (issue #63).
  const knipRuis = 1e-9 * Math.max(1, length);
  const opKnip = (s: number) => Math.abs(s - splitDistance) <= knipRuis;

  let nextMemberLoadId = nextEntityId(model.memberLoads ?? []);
  const memberLoads = (model.memberLoads ?? []).flatMap((load): OpenFem3DMemberLoad[] => {
    if (load.beamId !== beamId) return [load];
    // Eindigt vóór of op het knippunt: geheel op het eerste deel; een eind op
    // het knippunt valt precies op het eind van dat deel.
    if (load.endPositionM <= splitDistance + knipRuis) {
      if (!atNode && load.endPositionM <= splitDistance) return [load];
      const startPositionM = onFirst(load.startPositionM);
      const endPositionM = opKnip(load.endPositionM) ? firstLength : onFirst(load.endPositionM);
      // Een last die geheel binnen de ruis om het knippunt lag, valt weg.
      return endPositionM > startPositionM ? [{ ...load, startPositionM, endPositionM }] : [];
    }
    // Begint op of na het knippunt: geheel op het tweede deel; een begin op
    // het knippunt valt precies op 0.
    if (load.startPositionM >= splitDistance - knipRuis) {
      const startPositionM = opKnip(load.startPositionM) ? 0 : onSecond(load.startPositionM);
      const endPositionM = onSecond(load.endPositionM);
      return endPositionM > startPositionM ? [{ ...load, beamId: secondBeamId, startPositionM, endPositionM }] : [];
    }
    // Over het knippunt heen (begin en eind verder dan de ruis ervan af): twee
    // stukken, elk langer dan de ruis.
    const loadRatio = (splitDistance - load.startPositionM) /
      (load.endPositionM - load.startPositionM);
    if (isOpenFem3DGlobalMemberLoad(load)) {
      // Globaal (#80): richting en projectie gelden voor beide delen (zelfde e_x).
      const qAtSplit = load.qStart + (load.qEnd - load.qStart) * loadRatio;
      return [
        { ...load, qEnd: qAtSplit, startPositionM: onFirst(load.startPositionM), endPositionM: firstLength },
        {
          ...load,
          id: nextMemberLoadId++,
          beamId: secondBeamId,
          qStart: qAtSplit,
          startPositionM: 0,
          endPositionM: onSecond(load.endPositionM),
        },
      ];
    }
    const qyAtSplit = load.qyStart + (load.qyEnd - load.qyStart) * loadRatio;
    const qzAtSplit = load.qzStart + (load.qzEnd - load.qzStart) * loadRatio;
    return [
      { ...load, qyEnd: qyAtSplit, qzEnd: qzAtSplit, startPositionM: onFirst(load.startPositionM), endPositionM: firstLength },
      {
        ...load,
        id: nextMemberLoadId++,
        beamId: secondBeamId,
        qyStart: qyAtSplit,
        qzStart: qzAtSplit,
        startPositionM: 0,
        endPositionM: onSecond(load.endPositionM),
      },
    ];
  });

  const memberPointLoads = (model.memberPointLoads ?? []).map((load): OpenFem3DMemberPointLoad => {
    if (load.beamId !== beamId) return load;
    if (load.positionM < splitDistance) return atNode ? { ...load, positionM: onFirst(load.positionM) } : load;
    return { ...load, beamId: secondBeamId, positionM: onSecond(load.positionM) };
  });

  let nextThermalLoadId = nextEntityId(model.thermalLoads ?? []);
  const thermalLoads = (model.thermalLoads ?? []).flatMap((load): OpenFem3DThermalLoad[] =>
    load.beamId !== beamId
      ? [load]
      : [load, { ...load, id: nextThermalLoadId++, beamId: secondBeamId }]);
  // Een belastingvlak vindt zijn liggers meetkundig, dus beide delen dragen
  // vanzelf weer mee. Alleen een bewuste uitsluiting moet het tweede deel ook
  // krijgen, anders gaat een windverband na knippen half last dragen.
  const loadPanels = model.loadPanels?.map((panel) => panel.excludedBeamIds?.includes(beamId)
    ? { ...panel, excludedBeamIds: [...panel.excludedBeamIds, secondBeamId] }
    : panel);

  return {
    model: {
      ...model,
      // Een staaf tussen twee knopen op hetzelfde level ligt op dat level; de
      // nieuwe tussenknoop hangt er dan ook aan, anders knikt de staaf zodra
      // de hoogte van het level verandert.
      nodes: existingNode ? model.nodes : [...model.nodes, {
        id: nodeId, ...splitPoint,
        ...(start.levelId !== undefined && start.levelId === end.levelId ? { levelId: start.levelId } : {}),
      }],
      beams,
      memberLoads,
      memberPointLoads,
      thermalLoads,
      ...(loadPanels ? { loadPanels } : {}),
    },
    nodeId,
    firstBeamId: beamId,
    secondBeamId,
  };
}

/**
 * Haal verwijderde staven uit de uitsluitlijst van elk belastingvlak. Een
 * blijvende verwijzing zou later een nieuwe staaf met hetzelfde nummer stil
 * uitsluiten, en de modelkeuring weigert een ontbrekende staaf terecht.
 */
function withoutExcludedBeams(
  panels: OpenFem3DLoadPanel[] | undefined, removedBeamIds: ReadonlySet<number>,
): OpenFem3DLoadPanel[] | undefined {
  if (!panels || removedBeamIds.size === 0) return panels;
  return panels.map((panel) => {
    if (!panel.excludedBeamIds?.some((id) => removedBeamIds.has(id))) return panel;
    const excludedBeamIds = panel.excludedBeamIds.filter((id) => !removedBeamIds.has(id));
    const { excludedBeamIds: _removed, ...rest } = panel;
    return excludedBeamIds.length > 0 ? { ...rest, excludedBeamIds } : rest;
  });
}

/** Platen zonder de lateien die naar een van deze (weggehaalde) staven verwijzen. */
function withoutLintelsOf(plates: OpenFem3DPlate[] | undefined, beamIds: ReadonlySet<number>): OpenFem3DPlate[] | undefined {
  if (!plates || !plates.some((plate) => (plate.openings ?? []).some((o) => o.lintel && beamIds.has(o.lintel.beamId)))) {
    return plates;
  }
  return plates.map((plate) => ({
    ...plate,
    ...(plate.openings ? {
      openings: plate.openings.map((opening) => {
        if (!opening.lintel || !beamIds.has(opening.lintel.beamId)) return opening;
        const { lintel: _removed, ...rest } = opening;
        return rest;
      }),
    } : {}),
  }));
}

export function removeOpenFem3DBeam(model: OpenFem3DModel, beamId: number): OpenFem3DModel {
  const loadPanels = withoutExcludedBeams(model.loadPanels, new Set([beamId]));
  const plates = withoutLintelsOf(model.plates, new Set([beamId]));
  return {
    ...model,
    ...(plates ? { plates } : {}),
    beams: model.beams.filter((beam) => beam.id !== beamId),
    memberLoads: (model.memberLoads ?? []).filter((load) => load.beamId !== beamId),
    memberPointLoads: (model.memberPointLoads ?? []).filter((load) => load.beamId !== beamId),
    thermalLoads: (model.thermalLoads ?? []).filter((load) => load.beamId !== beamId),
    ...(loadPanels ? { loadPanels } : {}),
  };
}

export function removeOpenFem3DLoadPanel(model: OpenFem3DModel, panelId: number): OpenFem3DModel {
  return { ...model, loadPanels: (model.loadPanels ?? []).filter((panel) => panel.id !== panelId) };
}

export function addOpenFem3DPlate(
  model: OpenFem3DModel,
  nodeIds: number[],
  options: {
    thicknessM?: number; material?: string; cornerRadiusM?: number; boundary?: OpenFem3DPlateBoundarySegment[];
    /** Plaat op bedding (#107); gekeurd zoals bij het lezen. */
    bedding?: OpenFem3DPlateBedding;
  } = {},
): OpenFem3DModel {
  const id = nextEntityId(model.plates ?? []);
  const parsed = parseOpenFem3DModel({
    ...model,
    plates: [...(model.plates ?? []), {
      id, nodeIds, thicknessM: options.thicknessM ?? 0.2, material: options.material ?? "C30/37",
      ...(options.boundary?.length ? { boundary: options.boundary } : {}),
      ...(options.cornerRadiusM && options.cornerRadiusM > 0 ? { cornerRadiusM: options.cornerRadiusM } : {}),
      ...(options.bedding !== undefined ? { bedding: options.bedding } : {}),
    }],
  });
  const addedPlate = parsed.plates?.[parsed.plates.length - 1];
  if (!addedPlate) throw new Error("De nieuwe 3D-plaat kon niet worden gevalideerd.");
  // Het invoermodel is al gevalideerd. Behoud daarom zijn onveranderde
  // objectreferenties en neem alleen de nieuwe, gevalideerde plaat over. De
  // 3D-viewer kan de plaat dan toevoegen zonder knopen, labels en staven
  // opnieuw op te bouwen.
  const legacyCopies = (model.plates ?? []).some((plate) =>
    hasCopiedBoundaryReference(plate.boundary, plate.nodeIds) ||
    (plate.openings ?? []).some((opening) => hasCopiedBoundaryReference(opening.boundary, opening.nodeIds)));
  return legacyCopies ? parsed : { ...model, plates: [...(model.plates ?? []), addedPlate] };
}

export function updateOpenFem3DPlate(
  model: OpenFem3DModel, plateId: number,
  patch: Partial<Pick<OpenFem3DPlate, "thicknessM" | "material" | "cornerRadiusM" | "meshSizeM" | "edgeSupports">>
    /** Plaat op bedding (#107); `null` haalt de bedding weg. */
    & { bedding?: OpenFem3DPlateBedding | null },
): OpenFem3DModel {
  if (!(model.plates ?? []).some((plate) => plate.id === plateId)) throw new Error(`3D-plaat ${plateId} bestaat niet.`);
  const parsed = parseOpenFem3DModel({
    ...model,
    plates: (model.plates ?? []).map((plate) => {
      if (plate.id !== plateId) return plate;
      const { bedding, ...rest } = patch;
      const next: OpenFem3DPlate = { ...plate, ...rest };
      // `meshSizeM: undefined` zet de elementgrootte terug op automatisch.
      if ("meshSizeM" in patch && patch.meshSizeM === undefined) delete next.meshSizeM;
      if ("edgeSupports" in patch && !patch.edgeSupports?.length) delete next.edgeSupports;
      // De bedding: een object zet haar (gekeurd door parseOpenFem3DModel), null haalt haar weg.
      if (bedding === null) delete next.bedding;
      else if (bedding !== undefined) next.bedding = bedding;
      return next;
    }),
  });
  const updatedPlate = parsed.plates?.find((plate) => plate.id === plateId);
  if (!updatedPlate) throw new Error(`3D-plaat ${plateId} kon niet worden gevalideerd.`);
  return {
    ...model,
    plates: (model.plates ?? []).map((plate) => plate.id === plateId ? updatedPlate : plate),
  };
}

export function addOpenFem3DPlateOpening(
  model: OpenFem3DModel,
  plateId: number,
  nodeIds: number[],
  cornerRadiusOrOptions: number | { cornerRadiusM?: number; boundary?: OpenFem3DPlateBoundarySegment[] } = 0,
): OpenFem3DModel {
  const plate = (model.plates ?? []).find((item) => item.id === plateId);
  if (!plate) throw new Error(`3D-plaat ${plateId} bestaat niet.`);
  const options = typeof cornerRadiusOrOptions === "number"
    ? { cornerRadiusM: cornerRadiusOrOptions }
    : cornerRadiusOrOptions;
  const id = nextEntityId(plate.openings ?? []);
  const parsed = parseOpenFem3DModel({
    ...model,
    plates: (model.plates ?? []).map((item) => item.id === plateId ? {
      ...item,
      openings: [...(item.openings ?? []), {
        id,
        nodeIds,
        ...(options.boundary?.length ? { boundary: options.boundary } : {}),
        ...(options.cornerRadiusM && options.cornerRadiusM > 0 ? { cornerRadiusM: options.cornerRadiusM } : {}),
      }],
    } : item),
  });
  const updatedPlate = parsed.plates?.find((item) => item.id === plateId);
  if (!updatedPlate) throw new Error(`De opening in 3D-plaat ${plateId} kon niet worden gevalideerd.`);
  return {
    ...model,
    plates: (model.plates ?? []).map((item) => item.id === plateId ? updatedPlate : item),
  };
}

/**
 * Maak van een plaat een metselwerkwand (#97) of zet haar terug (`null`).
 * De plaat moet verticaal staan. Terugzetten haalt ook de lateien weg (de
 * staven zelf blijven staan als gewone staven).
 */
export function setOpenFem3DPlateMasonry(
  model: OpenFem3DModel, plateId: number, masonry: OpenFem3DMasonryWall | null,
): OpenFem3DModel {
  const plate = (model.plates ?? []).find((item) => item.id === plateId);
  if (!plate) throw new Error(`3D-plaat ${plateId} bestaat niet.`);
  if (masonry === null) {
    const { masonry: _removed, ...rest } = plate;
    const openings = rest.openings?.map(({ lintel: _lintel, ...opening }) => opening);
    return { ...model, plates: (model.plates ?? []).map((item) => item.id === plateId
      ? { ...rest, ...(openings ? { openings } : {}) } : item) };
  }
  const checked = readOpenFem3DMasonryWall(masonry, `3D-plaat ${plateId}`);
  // De wand moet verticaal staan; dezelfde keuring als bij het rekenen.
  openFem3DWallFrame(model, plate);
  return { ...model, plates: (model.plates ?? []).map((item) => item.id === plateId ? { ...item, masonry: checked } : item) };
}

export interface OpenFem3DLintelInput {
  bearingM: number;
  loadSpread: OpenFem3DLintelLoadSpread;
  /** Doorsnede en materiaal van een NIEUWE lateistaaf; standaard S235 HEA 100. */
  profileName?: string;
  material?: string;
}

/**
 * Zet een latei boven een opening van een metselwerkwand (#97), of wijzig
 * haar. De latei is een gewone staaf van de bovenrand van de opening, aan
 * beide zijden met de opleglengte verlengd; haar eindknopen worden
 * toegevoegd (of hergebruikt als er al een knoop op die plek ligt). Bij een
 * andere opleglengte gaat de staaf naar de nieuwe eindpunten.
 */
export function setOpenFem3DOpeningLintel(
  model: OpenFem3DModel, plateId: number, openingId: number, input: OpenFem3DLintelInput,
): OpenFem3DModel {
  const plate = (model.plates ?? []).find((item) => item.id === plateId);
  if (!plate) throw new Error(`3D-plaat ${plateId} bestaat niet.`);
  if (!plate.masonry) throw new Error(`3D-plaat ${plateId} is geen metselwerkwand.`);
  const opening = (plate.openings ?? []).find((item) => item.id === openingId);
  if (!opening) throw new Error(`Opening ${openingId} van 3D-plaat ${plateId} bestaat niet.`);
  if (input.loadSpread !== "triangle60" && input.loadSpread !== "fullHeight") {
    throw new Error(`Onbekende lastspreiding "${String(input.loadSpread)}".`);
  }
  const [startPoint, endPoint] = openFem3DLintelEnds(model, plate, opening, input.bearingM);
  let next = model;
  const nodeAt = (p: [number, number, number]) => {
    const existing = nodeAtSamePosition(next, p[0], p[1], p[2]);
    if (existing) return existing.id;
    const added = addOpenFem3DNode(next, { x: p[0], y: p[1], z: p[2] });
    next = added.model;
    return added.node.id;
  };
  const startNodeId = nodeAt(startPoint);
  const endNodeId = nodeAt(endPoint);
  const current = opening.lintel && next.beams.find((beam) => beam.id === opening.lintel!.beamId);
  let beamId: number;
  if (current) {
    beamId = current.id;
    if (current.startNodeId !== startNodeId || current.endNodeId !== endNodeId) {
      next = updateOpenFem3DBeam(next, beamId, { startNodeId, endNodeId });
    }
  } else {
    const added = addOpenFem3DBeam(next, {
      startNodeId, endNodeId,
      profileName: input.profileName ?? OPEN_FEM_3D_LINTEL_DEFAULT.profileName,
      material: input.material ?? OPEN_FEM_3D_LINTEL_DEFAULT.material,
    });
    next = added.model;
    beamId = added.beam.id;
  }
  const lintel: OpenFem3DOpeningLintel = { beamId, bearingM: input.bearingM, loadSpread: input.loadSpread };
  return {
    ...next,
    plates: (next.plates ?? []).map((item) => item.id !== plateId ? item : {
      ...item,
      openings: (item.openings ?? []).map((o) => o.id === openingId ? { ...o, lintel } : o),
    }),
  };
}

/** Haal de latei boven een opening weg, met haar staaf. */
export function removeOpenFem3DOpeningLintel(model: OpenFem3DModel, plateId: number, openingId: number): OpenFem3DModel {
  const opening = (model.plates ?? []).find((item) => item.id === plateId)?.openings?.find((item) => item.id === openingId);
  if (!opening?.lintel) return model;
  return removeOpenFem3DBeam(model, opening.lintel.beamId);
}

export function removeOpenFem3DPlate(model: OpenFem3DModel, plateId: number): OpenFem3DModel {
  return { ...model, plates: (model.plates ?? []).filter((plate) => plate.id !== plateId),
    surfaceLoads: (model.surfaceLoads ?? []).filter((load) => load.plateId !== plateId) };
}

export function addOpenFem3DSurfaceLoad(
  model: OpenFem3DModel, plateId: number, values: Pick<OpenFem3DSurfaceLoad, "qx" | "qy" | "qz">, caseId?: number,
): OpenFem3DModel {
  const id = nextEntityId(model.surfaceLoads ?? []);
  return parseOpenFem3DModel({ ...model, surfaceLoads: [...(model.surfaceLoads ?? []), { id, plateId, ...values, ...(caseId ? { caseId } : {}) }] });
}

export function updateOpenFem3DSurfaceLoad(
  model: OpenFem3DModel, loadId: number, values: Pick<OpenFem3DSurfaceLoad, "qx" | "qy" | "qz">,
): OpenFem3DModel {
  if (!(model.surfaceLoads ?? []).some((load) => load.id === loadId)) throw new Error(`3D-oppervlaktebelasting ${loadId} bestaat niet.`);
  return parseOpenFem3DModel({ ...model, surfaceLoads: (model.surfaceLoads ?? []).map((load) => load.id === loadId ? { ...load, ...values } : load) });
}

export function removeOpenFem3DSurfaceLoad(model: OpenFem3DModel, loadId: number): OpenFem3DModel {
  return { ...model, surfaceLoads: (model.surfaceLoads ?? []).filter((load) => load.id !== loadId) };
}

/** Keep all other node conditions when one node is deleted. */
export function removeOpenFem3DNode(model: OpenFem3DModel, nodeId: number): OpenFem3DModel {
  const removedBeamIds = new Set(model.beams
    .filter((beam) => beam.startNodeId === nodeId || beam.endNodeId === nodeId)
    .map((beam) => beam.id));
  const removedPlateIds = new Set((model.plates ?? []).filter((plate) =>
    plate.nodeIds.includes(nodeId) || (plate.openings ?? []).some((opening) => opening.nodeIds.includes(nodeId)))
    .map((plate) => plate.id));
  // Een belastingvlak zonder een van zijn hoekknopen bestaat niet meer.
  const loadPanels = withoutExcludedBeams(
    model.loadPanels?.filter((panel) => !panel.nodeIds.includes(nodeId)
      && !(panel.openings ?? []).some((opening) => opening.nodeIds.includes(nodeId))), removedBeamIds);
  const envelopePanels = model.envelopePanels?.filter((panel) => !panel.nodeIds.includes(nodeId)
    && !(panel.openings ?? []).some((opening) => opening.nodeIds.includes(nodeId)));
  return {
    ...model,
    nodes: model.nodes.filter((node) => node.id !== nodeId),
    beams: model.beams.filter((beam) => beam.startNodeId !== nodeId && beam.endNodeId !== nodeId),
    supports: (model.supports ?? []).filter((support) => support.nodeId !== nodeId),
    loads: (model.loads ?? []).filter((load) => load.nodeId !== nodeId),
    memberLoads: (model.memberLoads ?? []).filter((load) => !removedBeamIds.has(load.beamId)),
    memberPointLoads: (model.memberPointLoads ?? []).filter((load) => !removedBeamIds.has(load.beamId)),
    thermalLoads: (model.thermalLoads ?? []).filter((load) => !removedBeamIds.has(load.beamId)),
    plates: (withoutLintelsOf(model.plates, removedBeamIds) ?? []).filter((plate) => !removedPlateIds.has(plate.id)),
    surfaceLoads: (model.surfaceLoads ?? []).filter((load) => !removedPlateIds.has(load.plateId)),
    ...(loadPanels ? { loadPanels } : {}),
    ...(envelopePanels ? { envelopePanels } : {}),
    ...(model.generatedNodeIds ? { generatedNodeIds: model.generatedNodeIds.filter((id) => id !== nodeId) } : {}),
    // De knoop verlaat zijn schijf; een schijf met minder dan twee knopen koppelt niets meer.
    ...(model.diaphragms !== undefined
      ? {
          diaphragms: model.diaphragms
            .map((diaphragm) => ({ ...diaphragm, nodeIds: diaphragm.nodeIds.filter((id) => id !== nodeId) }))
            .filter((diaphragm) => diaphragm.nodeIds.length >= 2),
        }
      : {}),
  };
}

/**
 * Verwijder de selectie, zoals de lintknop Verwijderen en de Delete-toets:
 * de gekozen lasten (een groepsselectie uit het selectiefilter, issue #94),
 * dan staven en platen, daarna knopen met alles wat eraan hangt. Een plaat
 * gaat met haar openingen en oppervlaktelasten weg; haar knopen blijven staan.
 */
export function removeOpenFem3DSelection(model: OpenFem3DModel, selection: OpenFem3DSelection): OpenFem3DModel {
  if (!selection) return model;
  if (selection.type === "multi") {
    let next = model;
    const loads = selection.loads ?? {};
    const weg = <K extends "loads" | "memberLoads" | "memberPointLoads" | "thermalLoads" | "surfaceLoads" | "loadPanels">(
      key: K, ids: number[] | undefined,
    ) => {
      const items = next[key] as { id: number }[] | undefined;
      if (!items || !ids?.length) return;
      const set = new Set(ids);
      next = { ...next, [key]: items.filter((item) => !set.has(item.id)) };
    };
    weg("loads", loads.nodalLoad);
    weg("memberLoads", loads.memberLoad);
    weg("memberPointLoads", loads.memberPointLoad);
    weg("thermalLoads", loads.thermalLoad);
    weg("surfaceLoads", loads.surfaceLoad);
    weg("loadPanels", loads.loadPanel);
    for (const beamId of selection.beamIds) next = removeOpenFem3DBeam(next, beamId);
    for (const plateId of selection.plateIds ?? []) next = removeOpenFem3DPlate(next, plateId);
    for (const nodeId of selection.nodeIds) next = removeOpenFem3DNode(next, nodeId);
    return next;
  }
  switch (selection.type) {
    case "beam": return removeOpenFem3DBeam(model, selection.id);
    case "node": return removeOpenFem3DNode(model, selection.id);
    case "nodalLoad": return removeOpenFem3DNodalLoad(model, selection.id);
    case "memberLoad": return removeOpenFem3DMemberLoad(model, selection.id);
    case "memberPointLoad": return removeOpenFem3DMemberPointLoad(model, selection.id);
    case "thermalLoad": return removeOpenFem3DThermalLoad(model, selection.id);
    case "plate": return removeOpenFem3DPlate(model, selection.id);
    case "surfaceLoad": return removeOpenFem3DSurfaceLoad(model, selection.id);
    case "loadPanel": return removeOpenFem3DLoadPanel(model, selection.id);
    case "envelopePanel": return { ...model, envelopePanels: (model.envelopePanels ?? []).filter((panel) => panel.id !== selection.id) };
  }
}

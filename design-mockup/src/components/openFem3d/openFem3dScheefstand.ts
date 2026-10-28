/**
 * Initiële scheefstand in de 3D-module (NEN-EN 1993-1-1 §5.3.2).
 *
 * WAT HIER GEBEURT
 * ----------------
 * φ zelf komt uit dezelfde normfunctie als in 2D (`bepaalScheefstand` in
 * `lib/scheefstandNorm.ts`); dit bestand levert daarvoor de 3D-geometrie
 * (h en m per richting) en zet φ om in lasten:
 *
 *  - §5.3.2(3): m is "het aantal kolommen in een rij", in het beschouwde
 *    verticale vlak. In 3D is dat per richting een andere rij: voor de
 *    scheefstand in X de kolommen in een vlak evenwijdig aan X (gegroepeerd op
 *    de y van de kolomvoet), voor Y die evenwijdig aan Y (op de x van de voet).
 *    Per richting geldt de KLEINSTE m over de rijen: die geeft de grootste α_m
 *    en dus de grootste φ. Zo ontstaan φ_X en φ_Y, elk met dezelfde
 *    normfunctie als 2D (issue #194). Tot 2026.43 telde de 3D-module alle
 *    kolomlijnen van het gebouw als één rij: een hal van 4 × 2 kolommen kreeg
 *    m = 8 en φ = 1/326,6 in beide richtingen, in plaats van φ_X = 1/309,8 en
 *    φ_Y = 1/282,8 (h = 6 m).
 *  - §5.3.2(7): de scheefstand mag vervangen worden door horizontale
 *    krachten. Hier krijgt ELKE verticale last V een horizontale component
 *    φ·V op zijn eigen aangrijpingspunt: een knooplast op de knoop, een
 *    verdeelde last langs de staaf. Dat is precies de last die een over φ
 *    gekantelde constructie onder dezelfde zwaartekracht voelt, en de som
 *    over een verdieping is φ·N_Ed van die verdieping.
 *  - §5.3.2(8): de scheefstand werkt in elke horizontale richting, maar in
 *    één richting tegelijk. Een combinatie ontvouwt daarom in vier varianten:
 *    +X en −X met φ_X, +Y en −Y met φ_Y. In de RESULTATEN (schakelaar
 *    Scheefstand aan) geldt dat voor elke combinatie, ook de BGT, zoals in 2D;
 *    de UGT-toets (`openFem3dToetsKrachten.ts`) ontvouwt alleen de UGT.
 *
 *  - §5.3.2(10) en figuur 5.5 (issue #212): de torsie door een
 *    antisymmetrische scheefstand van twee tegenoverliggende gevels. Met de
 *    instelling `scheefstandTorsie` krijgt elke richting met twee of meer
 *    kolomrijen twee varianten extra (+ en −), waarin de buitenste rijen
 *    tegengesteld scheefstaan en de scheefstand ertussen lineair verloopt:
 *    een starre verdraaiing van de plattegrond. Elke verticale last V krijgt
 *    dan s·φ·V met s = 1 − 2·(p − p_van)/(p_tot − p_van), p de coördinaat
 *    haaks op de richting (y bij X, x bij Y) en p_van, p_tot die van de
 *    buitenste rijen. Een verdeelde staaflast krijgt zo een kwadratisch
 *    verloop; dat gaat als het gelijkwaardige trapezium met dezelfde
 *    resultante en werklijn (`trapeziumVanProduct`). Een vlaklast op een plaat
 *    kent het rekencontract alleen uniform per plaat; daar weigert de
 *    torsievariant met reden (de UGT-toets weigert een model met platen in
 *    3D toch al, issue #199). Uit (de standaard) = geen torsievarianten, en
 *    de toelichting zegt dat ze ontbreken.
 *  - Eigen scheefstand per losse kolom (issue #199, fase 3; instelling
 *    `scheefstandEigenKolom`): een kolomlijn met een vrije kop hangt nergens
 *    aan en middelt haar scheefstand met niets. Haar lasten krijgen
 *    φ = max(φ_model, φ_eigen) met φ_eigen volgens de norm van haar materiaal,
 *    h = haar eigen hoogte en m = 1 (EN 1993-1-1 (5.5), EN 1992-1-1 (5.1),
 *    EN 1995-1-1 (5.1)): vervangen, nooit optellen (`eigenKolomScheefstand3D`).
 *    Een om haar as gedraaide kolom krijgt φ_eigen/max(|cos α|, |sin α|), zodat
 *    langs elke hoofdas minstens φ_eigen werkt. Daarmee geldt de φ-eis van een
 *    vrij staafeind (`openFem3DZijdelingseKnik`) voor deze kolom altijd.
 *  - Handmatige m per richting (issue #212): `aantalPerAs` in de keuze
 *    overschrijft de afgeleide m_X of m_Y (EN 1993-1-1 5.3.2(3) laat een
 *    kolom met minder dan 50 % van de gemiddelde verticale last weg).
 *
 * De omzetting werkt op het rekenverzoek NA het samenstellen van de
 * combinatie (factoren, eigen gewicht en belastingvlakken zijn dan al
 * verwerkt), zodat elke verticale last meedoet, ook de afdracht van een
 * belastingvlak.
 *
 * Puur: geen React, geen DOM, geen Tauri.
 */
import {
  SCHEEFSTAND_COMBO_OFFSET,
  type LoadCombination,
} from "../fem/solver/combinations";
import {
  bepaalScheefstand,
  noemerTekst,
  phiVolgensNorm,
  scheefstandUitkomstRegels,
  VERTICAAL_VANAF_GRADEN,
  type Kolomlijn,
  type ScheefstandGeometrie,
  type ScheefstandKeuze,
  type ScheefstandNorm,
  type ScheefstandUitkomst,
} from "../../lib/scheefstandNorm";
import {
  nederlands, vertaalWaarde, vt,
  type TekstWaarde, type VertaalbareTekst, type Vertaalfunctie,
} from "../../lib/vertaalbareTekst";
import { STEEL_GRADES } from "../../lib/steelGrades";
import {
  isOpenFem3DGlobalMemberLoad, openFem3DGlobalMemberLoadFactor, openFem3DMemberAxes,
  type OpenFem3DGlobalDirection, type OpenFem3DModel,
} from "./openFem3dModel";
import { openFem3DEinden } from "./openFem3dUitkraging";

const S = "common:loadCases.swayDerivation.";

export type OpenFem3DScheefstandAs = "x" | "y";

/** De twee horizontale assen, in de volgorde waarin ze getoond worden. */
export const OPEN_FEM_3D_SCHEEFSTAND_ASSEN: readonly OpenFem3DScheefstandAs[] = ["x", "y"];

/** φ per horizontale richting, in rad. */
export type OpenFem3DPhiPerAs = Record<OpenFem3DScheefstandAs, number>;

/**
 * De buitenste kolomrijen haaks op een richting, voor de torsievariant van
 * EN 1993-1-1 5.3.2(10): p_van en p_tot in m (y bij X, x bij Y).
 */
export interface OpenFem3DTorsieRijen {
  vanM: number;
  totM: number;
}

/** Per richting de buitenste rijen; ontbreekt = minder dan twee rijen, geen torsievariant. */
export type OpenFem3DTorsiePerAs = Partial<Record<OpenFem3DScheefstandAs, OpenFem3DTorsieRijen>>;

/** Eén richting van de scheefstand in één berekening. */
export interface OpenFem3DScheefstand {
  /** φ in rad: φ_X bij de as x, φ_Y bij de as y. */
  phi: number;
  as: OpenFem3DScheefstandAs;
  richting: 1 | -1;
  /**
   * De torsievariant (5.3.2(10), issue #212): de rijen op p_van krijgen
   * +richting·φ, die op p_tot −richting·φ, lineair ertussen.
   */
  torsie?: OpenFem3DTorsieRijen;
  /**
   * De eigen scheefstand van losse kolommen (issue #199, fase 3): per staaf en
   * per knoop de φ van deze richting die in plaats van `phi` geldt.
   */
  phiPerStaaf?: ReadonlyMap<number, number>;
  phiPerKnoop?: ReadonlyMap<number, number>;
}

/** Eén losse kolom: een kolomlijn met een vrije kop (issue #199, fase 3). */
export interface OpenFem3DLosseKolom {
  staafIds: number[];
  /**
   * Staven die alleen aan de kolom hangen (de luifel of T, issue #199); hun
   * lasten krijgen dezelfde eigen φ. Ontbreekt = geen.
   */
  aanhangendeStaafIds?: number[];
  /** De knopen boven de voet, ook die van de aanhangende staven. */
  knoopIds: number[];
  hoogteM: number;
  norm: ScheefstandNorm;
  /** φ_eigen volgens de norm, met h = de hoogte en m = 1. */
  phiEigen: number;
  /** max(|cos α|, |sin α|) van de draaiing om de as; 1 = niet gedraaid. */
  factor: number;
}

/** De eigen scheefstand van de losse kolommen, per staaf en knoop per richting. */
export interface OpenFem3DEigenKolomPhi {
  kolommen: OpenFem3DLosseKolom[];
  perStaaf: Map<number, OpenFem3DPhiPerAs>;
  perKnoop: Map<number, OpenFem3DPhiPerAs>;
}

/** Nederlandse getalweergave: komma als decimaalteken. */
function getal(x: number, decimalen: number): string {
  return x.toFixed(decimalen).replace(".", ",");
}

/** Hoofdletter van een as, voor teksten ("X", "Y"). */
const AS_LABEL: Record<OpenFem3DScheefstandAs, "X" | "Y"> = { x: "X", y: "Y" };
/** De coördinaat waarop de rijen van een richting gegroepeerd worden: y voor X, x voor Y. */
const RIJ_COORDINAAT: Record<OpenFem3DScheefstandAs, "x" | "y"> = { x: "y", y: "x" };

/**
 * Kolomvoeten die hoogstens dit uit elkaar liggen (in de coördinaat haaks op
 * de rij) horen bij dezelfde rij. Klein met opzet: een te kleine tolerantie
 * splitst een rij en geeft een kleinere m, dus een grotere φ (de veilige
 * kant); een te grote zou rijen samenvoegen en φ verkleinen.
 */
export const RIJ_TOLERANTIE_MM = 1;

/** Eén kolomlijn in 3D: als in 2D, met de y van de voet erbij. */
export interface Kolomlijn3D extends Kolomlijn {
  voetYmm: number;
}

/** Eén rij kolommen evenwijdig aan een as. */
export interface OpenFem3DKolomrij {
  /** De coördinaat haaks op de rij (y bij een rij evenwijdig aan X), in mm. */
  coordinaatMm: number;
  /** Het aantal kolomlijnen in de rij. */
  aantal: number;
}

/** De geometrie van één richting: wat `bepaalScheefstand` nodig heeft, plus de rijen. */
export interface ScheefstandGeometrieAs extends ScheefstandGeometrie {
  rijen: OpenFem3DKolomrij[];
}

/**
 * De 3D-geometrie. De velden van `ScheefstandGeometrie` beschrijven het
 * geheel (m = de kleinste van m_X en m_Y); `perAs` is wat φ_X en φ_Y rekenen.
 */
export interface ScheefstandGeometrie3D extends ScheefstandGeometrie {
  kolomlijnen: Kolomlijn3D[];
  /** Per richting: m = de kleinste rij, en de afleiding daarvan. */
  perAs: Record<OpenFem3DScheefstandAs, ScheefstandGeometrieAs>;
  /** De opmerkingen die voor beide richtingen gelden (50 %-criterium, wanden, losse rijen). */
  notities: VertaalbareTekst[];
}

/** Groepeer de kolomlijnen op één voetcoördinaat (mm) tot rijen, oplopend. */
function groepeerRijen(lijnen: readonly Kolomlijn3D[], sleutel: "voetXmm" | "voetYmm"): OpenFem3DKolomrij[] {
  const waarden = lijnen.map((l) => l[sleutel]).sort((a, b) => a - b);
  const groepen: number[][] = [];
  for (const w of waarden) {
    const laatste = groepen[groepen.length - 1];
    if (laatste && w - laatste[laatste.length - 1] <= RIJ_TOLERANTIE_MM) laatste.push(w);
    else groepen.push([w]);
  }
  return groepen.map((g) => ({ coordinaatMm: g.reduce((som, w) => som + w, 0) / g.length, aantal: g.length }));
}

/**
 * h en m uit het 3D-model, met dezelfde regels als de 2D-afleiding
 * (`leidScheefstandGeometrieAf`): h van de laagste oplegging tot de hoogste
 * knoop. Een kolomlijn is een samenhangende keten van staven die steiler staan
 * dan 75° met het horizontale vlak; een kolom die door drie verdiepingen loopt
 * telt dus één keer.
 *
 * m per richting (§5.3.2(3), "het aantal kolommen in een rij"): de kolomlijnen
 * gegroepeerd op de y van hun voet (rijen evenwijdig aan X, voor φ_X) en op de
 * x (rijen evenwijdig aan Y, voor φ_Y); per richting de kleinste rij. Het veld
 * `aantalElementen` van het geheel is de kleinste van de twee. Coördinaten in m.
 */
export function leidScheefstandGeometrieAf3D(
  model: Pick<OpenFem3DModel, "nodes" | "beams" | "supports"> & Partial<Pick<OpenFem3DModel, "plates">>,
): ScheefstandGeometrie3D {
  const knoop = new Map(model.nodes.map((n) => [n.id, n]));
  const alleZ = model.nodes.map((n) => n.z);
  const topZ = alleZ.length > 0 ? Math.max(...alleZ) : 0;
  const opleggingZ = (model.supports ?? [])
    .map((s) => knoop.get(s.nodeId)?.z)
    .filter((z): z is number => typeof z === "number");
  const heeftOpleggingen = opleggingZ.length > 0;
  const voetZ = heeftOpleggingen ? Math.min(...opleggingZ) : alleZ.length > 0 ? Math.min(...alleZ) : 0;
  const hoogteM = Math.max(0, topZ - voetZ);
  const voetMm = getal(voetZ * 1000, 0);
  const voet = heeftOpleggingen
    ? vt(`${S}footLowestSupport`, `laagste oplegging, z = ${voetMm} mm`, { z: voetMm })
    : vt(`${S}footLowestNode`, `geen opleggingen in het model, dus de laagste knoop, z = ${voetMm} mm`, { z: voetMm });
  const hoogteRegel = vt(`${S}heightDerivation`,
    `h = ${getal(hoogteM, 3)} m — van de voet (${voet.tekst}) tot de bovenkant van de constructie ` +
      `(z = ${getal(topZ * 1000, 0)} mm). ` +
      "EN 1993-1-1 figuur 5.2 meet h vanaf het opleggingsniveau; " +
      "EN 1992-1-1 §5.2(6) noemt het voor de schorende constructie de hoogte " +
      "van het gebouw.",
    { h: getal(hoogteM, 3), voet, top: getal(topZ * 1000, 0) });

  const minSinus = Math.sin((VERTICAAL_VANAF_GRADEN * Math.PI) / 180);
  const verticaal = model.beams.filter((beam) => {
    const a = knoop.get(beam.startNodeId), b = knoop.get(beam.endNodeId);
    if (!a || !b) return false;
    const lengte = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    return lengte > 1e-9 && Math.abs(b.z - a.z) / lengte >= minSinus;
  });
  // Union-find over de knopen: verticale staven die een knoop delen vormen één kolom.
  const ouder = new Map<number, number>();
  const wortel = (x: number): number => {
    let r = x;
    while (ouder.get(r) !== r) r = ouder.get(r)!;
    let k = x;
    while (ouder.get(k) !== r) { const volgende = ouder.get(k)!; ouder.set(k, r); k = volgende; }
    return r;
  };
  for (const beam of verticaal) for (const n of [beam.startNodeId, beam.endNodeId]) if (!ouder.has(n)) ouder.set(n, n);
  for (const beam of verticaal) {
    const ra = wortel(beam.startNodeId), rb = wortel(beam.endNodeId);
    if (ra !== rb) ouder.set(ra, rb);
  }
  const perWortel = new Map<number, number[]>();
  for (const beam of verticaal) {
    const r = wortel(beam.startNodeId);
    perWortel.set(r, [...(perWortel.get(r) ?? []), beam.id]);
  }
  const lijnen: Kolomlijn3D[] = [];
  for (const staafIds of perWortel.values()) {
    const punten = staafIds.flatMap((id) => {
      const beam = verticaal.find((v) => v.id === id)!;
      return [knoop.get(beam.startNodeId)!, knoop.get(beam.endNodeId)!];
    });
    const laagste = punten.reduce((l, p) => (p.z < l.z ? p : l), punten[0]);
    lijnen.push({
      staafIds: [...staafIds].sort((a, b) => a - b),
      voetZmm: laagste.z * 1000,
      topZmm: Math.max(...punten.map((p) => p.z)) * 1000,
      voetXmm: laagste.x * 1000,
      voetYmm: laagste.y * 1000,
    });
  }
  lijnen.sort((a, b) => a.voetXmm - b.voetXmm || a.voetYmm - b.voetYmm || a.voetZmm - b.voetZmm);
  const afleidbaar = lijnen.length > 0 && hoogteM > 0;

  // Opmerkingen die voor beide richtingen gelden.
  const notities: VertaalbareTekst[] = [vt(`${S}membersNote50Percent`,
    "LET OP bij m: EN 1993-1-1 5.3.2(3)a telt alleen kolommen mee die " +
      "minstens 50 % van de gemiddelde verticale kolomkracht dragen. Die " +
      "krachten volgen uit de berekening en de berekening heeft φ nodig, dus " +
      "dat criterium is hier niet toegepast — álle kolomlijnen tellen mee. " +
      "Een licht belaste stijl hoort er met de hand uit: kleinere m geeft " +
      "grotere α_m en dus grotere φ, de veilige kant.")];
  if ((model.plates?.length ?? 0) > 0) {
    notities.push(vt(`${S}wallsNotCounted`,
      "Wandschijven tellen niet mee in m: een schijf schoort meestal in plaats " +
        "van geschoord te worden, en meetellen zou m verhogen en φ verlagen. " +
        "Draagt een wand hier wél verticaal mee, verhoog m dan met de hand."));
  }

  const perAs = {} as Record<OpenFem3DScheefstandAs, ScheefstandGeometrieAs>;
  let losseRij = false;
  for (const as of OPEN_FEM_3D_SCHEEFSTAND_ASSEN) {
    const richting = AS_LABEL[as];
    const coordinaat = RIJ_COORDINAAT[as];
    const rijen = groepeerRijen(lijnen, coordinaat === "y" ? "voetYmm" : "voetXmm");
    const m = rijen.length > 0 ? Math.min(...rijen.map((r) => r.aantal)) : 1;
    if (lijnen.length > 1 && m === 1) losseRij = true;
    let mRegel: VertaalbareTekst;
    if (rijen.length === 0) {
      mRegel = vt(`${S}membersFallbackAxis`,
        `m_${richting} = 1 (terugval) — dit model bevat geen enkele staaf die steiler staat ` +
          `dan ${VERTICAAL_VANAF_GRADEN}° met de horizontaal, dus er is geen kolomrij te tellen. ` +
          "m = 1 geeft α_m = 1,00: de grootste waarde die de formule kan " +
          "aannemen, en dus de veilige terugval.",
        { richting, graden: VERTICAAL_VANAF_GRADEN });
    } else {
      const lijst = {
        lijst: rijen.map((r) => vt(`${S}rowItem3d`,
          `${coordinaat} = ${getal(r.coordinaatMm, 0)} mm: ${r.aantal}`,
          { as: coordinaat, c: getal(r.coordinaatMm, 0), aantal: r.aantal })),
        scheiding: "; ",
      };
      mRegel = vt(`${S}membersDerivedAxis`,
        `m_${richting} = ${m} — de kleinste rij evenwijdig aan ${richting}: EN 1993-1-1 5.3.2(3) telt ` +
          "de kolommen in een rij, in het beschouwde verticale vlak. " +
          `Kolommen per rij, op de ${coordinaat} van de kolomvoet: ${nederlands(lijst)}. ` +
          `Een staaf telt als verticaal vanaf ${VERTICAAL_VANAF_GRADEN}° met de horizontaal; ` +
          "staven die een knoop delen vormen samen één kolom, en voeten tot " +
          `${RIJ_TOLERANTIE_MM} mm uit elkaar horen bij dezelfde rij.`,
        { richting, m, as: coordinaat, lijst, graden: VERTICAAL_VANAF_GRADEN, tolerantie: RIJ_TOLERANTIE_MM });
    }
    const teksten = [hoogteRegel, mRegel];
    perAs[as] = {
      hoogteM, aantalElementen: m, kolomlijnen: lijnen, rijen, afleidbaar,
      afleiding: teksten.map((t) => t.tekst), afleidingTeksten: teksten,
    };
  }
  if (losseRij) {
    notities.push(vt(`${S}rowsSkewNote`,
      "LET OP bij de rijen: die lopen evenwijdig aan de globale X- en Y-as. Een kolom " +
        "die alleen in zijn rij staat (een gevelstijl, of een gebouw dat scheef op de " +
        "assen staat) geeft m = 1 en de grootste φ, de veilige kant. Hoort hij niet bij " +
        "de dragende rijen, geef m dan met de hand op."));
  }
  for (const as of OPEN_FEM_3D_SCHEEFSTAND_ASSEN) {
    perAs[as].afleidingTeksten.push(...notities);
    perAs[as].afleiding = perAs[as].afleidingTeksten.map((t) => t.tekst);
  }
  const afleidingTeksten = [hoogteRegel, perAs.x.afleidingTeksten[1], perAs.y.afleidingTeksten[1], ...notities];
  return {
    hoogteM,
    aantalElementen: Math.min(perAs.x.aantalElementen, perAs.y.aantalElementen),
    kolomlijnen: lijnen,
    afleidbaar,
    afleiding: afleidingTeksten.map((a) => a.tekst),
    afleidingTeksten,
    perAs,
    notities,
  };
}

/** De normen die het 3D-model aandraagt, uit de materialen van de staven. */
export function toepasselijkeScheefstandNormen3D(model: Pick<OpenFem3DModel, "beams">): ScheefstandNorm[] {
  const normen = new Set<ScheefstandNorm>();
  for (const beam of model.beams) {
    const materiaal = beam.material?.trim().toUpperCase() ?? "";
    if (STEEL_GRADES.includes(materiaal)) normen.add("en1993");
    else if (/^C\d+\/\d+/.test(materiaal)) normen.add("en1992");
    else if (/^(C|D|GL|LVL)\s?\d/.test(materiaal)) normen.add("en1995");
  }
  return (["en1993", "en1992", "en1995"] as const).filter((norm) => normen.has(norm));
}

/**
 * De buitenste kolomrijen per richting voor de torsievariant (5.3.2(10)):
 * alleen een richting met twee of meer rijen. Coördinaten in m.
 */
export function torsieRijen3D(geometrie: Pick<ScheefstandGeometrie3D, "perAs">): OpenFem3DTorsiePerAs {
  const uit: OpenFem3DTorsiePerAs = {};
  for (const as of OPEN_FEM_3D_SCHEEFSTAND_ASSEN) {
    const rijen = geometrie.perAs[as].rijen;
    if (rijen.length < 2) continue;
    const c = rijen.map((r) => r.coordinaatMm);
    uit[as] = { vanM: Math.min(...c) / 1000, totM: Math.max(...c) / 1000 };
  }
  return uit;
}

/**
 * De losse kolommen van het model en hun eigen scheefstand (issue #199, fase
 * 3). Een kolomlijn (staven steiler dan 75° die een knoop delen,
 * `leidScheefstandGeometrieAf3D`) is LOS als geen knoop boven de voet een
 * oplegging heeft of in een plaat ligt, en wat er boven de voet aan haar
 * vastzit nergens anders aan hangt (`hangendDeel`: geen oplegging, plaat of
 * andere kolomlijn). Per richting geldt dan voor haar lasten, en die van de
 * aanhangende staven, φ = max(φ_model, φ_eigen/factor). Zo telt ook de
 * luifel- of T-kolom (een uitkragende ligger op de kop) als los; een kolom met
 * een ligger naar iets anders niet, daar blijft de φ-eis van het vrije eind.
 */
export function eigenKolomScheefstand3D(
  model: Pick<OpenFem3DModel, "nodes" | "beams" | "supports"> & Partial<Pick<OpenFem3DModel, "plates">>,
  phiModel: OpenFem3DPhiPerAs,
): OpenFem3DEigenKolomPhi {
  const uit: OpenFem3DEigenKolomPhi = { kolommen: [], perStaaf: new Map(), perKnoop: new Map() };
  const geometrie = leidScheefstandGeometrieAf3D(model);
  const knoop = new Map(model.nodes.map((n) => [n.id, n]));
  const einden = openFem3DEinden({ plates: [], ...model } as OpenFem3DModel);
  const opgelegd = new Set((model.supports ?? []).map((s) => s.nodeId));
  const inLijn = new Set(geometrie.kolomlijnen.flatMap((l) => l.staafIds));
  const andereLijn = (id: number, eigen: ReadonlySet<number>) => inLijn.has(id) && !eigen.has(id);
  for (const lijn of geometrie.kolomlijnen) {
    const staven = model.beams.filter((b) => lijn.staafIds.includes(b.id));
    if (staven.length === 0) continue;
    const knopen = [...new Set(staven.flatMap((b) => [b.startNodeId, b.endNodeId]))];
    const voet = knopen.reduce((l, id) => ((knoop.get(id)?.z ?? Infinity) < (knoop.get(l)?.z ?? Infinity) ? id : l), knopen[0]);
    const boven = knopen.filter((id) => id !== voet);
    const eigen = new Set(lijn.staafIds);
    if (staven.some((b) => b.bedding)) continue;
    if (boven.some((id) => opgelegd.has(id) || einden.knoopInPlaat(id))) continue;
    // Wat er boven de voet aan de kolom hangt (de luifel of T: een uitkragende
    // ligger op de kop) mag er zitten, zolang het nergens anders aan vastzit:
    // geen oplegging, plaat of andere kolomlijn (`hangendDeel`). De voet wordt
    // bereikt maar niet doorlopen; de aanhangende staven en knopen krijgen
    // dezelfde eigen φ.
    const aanhangend = new Set<number>();
    const knopenMetEigen = new Set<number>(boven);
    let los = true;
    for (const id of boven) {
      const deel = einden.hangendDeel(id, eigen, new Set(), new Set([voet]), (b) => andereLijn(b.id, eigen));
      if (!deel) { los = false; break; }
      deel.staafIds.forEach((s) => aanhangend.add(s));
      deel.knoopIds.forEach((k) => knopenMetEigen.add(k));
    }
    if (!los) continue;
    const hoogteM = (lijn.topZmm - lijn.voetZmm) / 1000;
    if (!(hoogteM > 0)) continue;
    const norm = toepasselijkeScheefstandNormen3D({ beams: staven })[0] ?? "en1993";
    const phiEigen = phiVolgensNorm(norm, hoogteM, 1).phi;
    const rol = staven[0].rollAngleRad ?? 0;
    const factor = Number.isFinite(rol) ? Math.max(Math.abs(Math.cos(rol)), Math.abs(Math.sin(rol))) : 1;
    const toegepast = phiEigen / factor;
    const perAs: OpenFem3DPhiPerAs = { x: Math.max(phiModel.x, toegepast), y: Math.max(phiModel.y, toegepast) };
    const aanhang = [...aanhangend].sort((a, b) => a - b);
    const knoopIds = [...knopenMetEigen].sort((a, b) => a - b);
    uit.kolommen.push({
      staafIds: [...lijn.staafIds], knoopIds, hoogteM, norm, phiEigen, factor,
      ...(aanhang.length > 0 ? { aanhangendeStaafIds: aanhang } : {}),
    });
    for (const id of [...lijn.staafIds, ...aanhang]) uit.perStaaf.set(id, perAs);
    for (const id of knoopIds) uit.perKnoop.set(id, perAs);
  }
  return uit;
}

/** De melding over de eigen scheefstand van de losse kolommen, of null zonder losse kolom. */
export function eigenKolomMelding3D(eigen: OpenFem3DEigenKolomPhi | null): string | null {
  if (!eigen || eigen.kolommen.length === 0) return null;
  const lijst = eigen.kolommen.map((k) => {
    const draai = k.factor < 1 - 1e-9 ? `, gedraaid: /${getal(k.factor, 3)}` : "";
    return `staaf ${k.staafIds.join("+")}` +
      (k.aanhangendeStaafIds ? ` met de aanhangende staaf ${k.aanhangendeStaafIds.join(", ")}` : "") +
      ` (h = ${getal(k.hoogteM, 3)} m, ${NORM_ARTIKEL[k.norm]}, ` +
      `φ_eigen = 1/${getal(1 / k.phiEigen, 0)}${draai})`;
  });
  return "Eigen scheefstand per losse kolom (issue #199, fase 3): een kolom met een vrije kop hangt nergens aan " +
    "en middelt haar scheefstand met niets; haar lasten krijgen φ = max(φ_model, φ_eigen) met h = haar eigen " +
    `hoogte en m = 1: ${lijst.join("; ")}. Daarmee zit haar zijdelingse knik in de toetskrachten en geldt de ` +
    "systeemlengte (NEN-EN 1993-1-1 5.2.2(7)b).";
}

const NORM_ARTIKEL: Record<ScheefstandNorm, string> = {
  en1993: "EN 1993-1-1 (5.5)", en1992: "EN 1992-1-1 (5.1)", en1995: "EN 1995-1-1 (5.1)",
};

/** De 3D-keuze: als in 2D, met een handmatige m per richting (issue #212). */
export interface ScheefstandKeuze3D extends ScheefstandKeuze {
  /**
   * Handmatige m_X en m_Y; `null`/ontbrekend = `aantalElementen`, en anders de
   * afgeleide m van die richting.
   */
  aantalPerAs?: Partial<Record<OpenFem3DScheefstandAs, number | null>>;
}

/** φ_X en φ_Y: per richting de uitkomst van `bepaalScheefstand`, met de m van die richting. */
export interface ScheefstandUitkomst3D {
  x: ScheefstandUitkomst;
  y: ScheefstandUitkomst;
  /** φ per richting, zoals de rekenroute ze gebruikt. */
  phi: OpenFem3DPhiPerAs;
  /** De waarschuwingen van beide richtingen, elk één keer. */
  waarschuwingen: string[];
  waarschuwingTeksten: VertaalbareTekst[];
}

/**
 * φ_X en φ_Y uit de projectinstelling: per richting dezelfde normfunctie als
 * 2D, met de m van die richting. Een handmatige m (`keuze.aantalElementen`)
 * geldt in beide richtingen, tenzij `keuze.aantalPerAs` er voor een richting
 * een eigen waarde geeft (issue #212); een handmatige h geldt in beide. Met de vaste noemer zijn
 * φ_X en φ_Y gelijk.
 */
export function bepaalScheefstand3D(
  keuze: ScheefstandKeuze3D,
  geometrie: ScheefstandGeometrie3D,
  toepasselijk: ScheefstandNorm[],
): ScheefstandUitkomst3D {
  const { aantalPerAs, ...gedeeld } = keuze;
  const perAs = (as: OpenFem3DScheefstandAs): ScheefstandKeuze => {
    const eigen = aantalPerAs?.[as];
    return typeof eigen === "number" && eigen >= 1 ? { ...gedeeld, aantalElementen: Math.floor(eigen) } : gedeeld;
  };
  const x = bepaalScheefstand(perAs("x"), geometrie.perAs.x, toepasselijk);
  const y = bepaalScheefstand(perAs("y"), geometrie.perAs.y, toepasselijk);
  const gezien = new Set<string>();
  const waarschuwingTeksten = [...x.waarschuwingTeksten, ...y.waarschuwingTeksten].filter((w) => {
    if (gezien.has(w.tekst)) return false;
    gezien.add(w.tekst);
    return true;
  });
  return {
    x, y, phi: { x: x.phi, y: y.phi },
    waarschuwingen: waarschuwingTeksten.map((w) => w.tekst),
    waarschuwingTeksten,
  };
}

/** "φ_X = 1/309,8 en φ_Y = 1/282,8", of "φ = 1/200" als ze gelijk zijn. */
export function phiPerAsTekst(phi: OpenFem3DPhiPerAs): string {
  const nx = noemerTekst(Math.round((1 / phi.x) * 10) / 10);
  const ny = noemerTekst(Math.round((1 / phi.y) * 10) / 10);
  return nx === ny ? `φ = 1/${nx}` : `φ_X = 1/${nx} en φ_Y = 1/${ny}`;
}

/**
 * φ van de toets in woorden: per richting als ze verschillen ("φ_X = 1/309,8
 * en φ_Y = 1/282,8"), anders één φ. Zonder `phiPerAs` (een oudere aanroeper)
 * de noemer.
 */
export function toetsPhiTekst3D(analyse: { noemer: number; phiPerAs?: OpenFem3DPhiPerAs }): string {
  return analyse.phiPerAs ? phiPerAsTekst(analyse.phiPerAs) : `φ = 1/${noemerTekst(analyse.noemer)}`;
}

/** Wat de toelichting over de torsievariant (5.3.2(10)) moet zeggen. */
export interface ToelichtingOpties3D {
  /** De instelling `scheefstandTorsie`: torsievarianten aan. */
  torsie?: boolean;
}

/** De regels van de 3D-toelichting, elk als tekst of vertaalbare tekst. */
function toelichtingRegels3D(
  uitkomst: ScheefstandUitkomst3D,
  geometrie: ScheefstandGeometrie3D,
  opties: ToelichtingOpties3D = {},
): TekstWaarde[] {
  const regels: TekstWaarde[] = [];
  if (uitkomst.x.norm === null && uitkomst.y.norm === null) {
    const [kop, ...tussenwaarden] = scheefstandUitkomstRegels(uitkomst.x);
    regels.push(kop, "", ...tussenwaarden);
    regels.push(vt(`${S}fixedBothAxes`, "Deze φ geldt in X en in Y."));
  } else {
    regels.push(vt(`${S}heading3d`,
      "Initiële scheefstand in 3D: per horizontale richting een eigen φ. EN 1993-1-1 " +
        "5.3.2(3) telt m per rij kolommen in het beschouwde vlak; de kleinste rij geeft " +
        "de grootste φ."));
    for (const as of OPEN_FEM_3D_SCHEEFSTAND_ASSEN) {
      const u = uitkomst[as];
      const noemer = noemerTekst(Math.round((1 / u.phi) * 10) / 10);
      regels.push("");
      regels.push(vt(`${S}axisHeading`, `Richting ${AS_LABEL[as]}: φ_${AS_LABEL[as]} = 1/${noemer}`,
        { richting: AS_LABEL[as], noemer }));
      regels.push(...scheefstandUitkomstRegels(u));
    }
    regels.push("");
    regels.push(uitkomst.x.hoogteHandmatig
      ? vt(`${S}heightManual`, `h is handmatig opgegeven: ${getal(uitkomst.x.hoogteM, 3)} m.`,
        { h: getal(uitkomst.x.hoogteM, 3) })
      : geometrie.afleidingTeksten[0]);
    if (uitkomst.x.aantalHandmatig && uitkomst.y.aantalHandmatig
        && uitkomst.x.aantalElementen === uitkomst.y.aantalElementen) {
      regels.push(vt(`${S}membersManualBoth`,
        `m is handmatig opgegeven: ${uitkomst.x.aantalElementen}, in X en in Y.`,
        { m: uitkomst.x.aantalElementen }));
    } else {
      // Per richting: de handmatige m (issue #212) naast de afgeleide, of de afleiding.
      for (const as of OPEN_FEM_3D_SCHEEFSTAND_ASSEN) {
        const u = uitkomst[as];
        regels.push(u.aantalHandmatig
          ? vt(`${S}membersManualAxis`,
            `m_${AS_LABEL[as]} is handmatig opgegeven: ${u.aantalElementen} (afgeleid uit de rijen: ` +
              `${geometrie.perAs[as].aantalElementen}). EN 1993-1-1 5.3.2(3) laat een kolom die minder ` +
              "dan 50 % van de gemiddelde verticale kolomkracht draagt buiten m.",
            { richting: AS_LABEL[as], m: u.aantalElementen, afgeleid: geometrie.perAs[as].aantalElementen })
          : geometrie.perAs[as].afleidingTeksten[1]);
      }
    }
    for (const r of geometrie.notities) regels.push(r);
  }
  regels.push("");
  // De UGT-toets rekent ALTIJD met deze scheefstand (issue #199), ook met de
  // schakelaar uit; de schakelaar geldt alleen voor de resultaten.
  regels.push(vt(`${S}directions3d`,
    "In 3D rekent de UGT-toets elke UGT-combinatie met de scheefstand in vier richtingen, één " +
      "tegelijk: +X en −X met φ_X, +Y en −Y met φ_Y (EN 1993-1-1 §5.3.2(8)). Elke verticale last V " +
      "krijgt op zijn eigen aangrijpingspunt een horizontale last φ·V (§5.3.2(7)). Dat doet de toets " +
      "altijd, ook als de schakelaar Scheefstand uit staat. Met die schakelaar aan rekenen ook de " +
      "resultaten zo, en dan elke combinatie, ook de BGT, zoals in 2D: strenger dan de norm vraagt " +
      "(EN 1992-1-1 §5.2(2)P en (3) plaatsen de imperfectie in de UGT), maar dezelfde keuze in 2D " +
      "en 3D."));
  const rijen = torsieRijen3D(geometrie);
  const torsieAssen = OPEN_FEM_3D_SCHEEFSTAND_ASSEN.filter((as) => rijen[as] !== undefined);
  if (opties.torsie && torsieAssen.length > 0) {
    const lijst = {
      lijst: torsieAssen.map((as) => vt(`${S}torsionAxisItem`,
        `${AS_LABEL[as]}: ${RIJ_COORDINAAT[as]} = ${getal(rijen[as]!.vanM * 1000, 0)} tot ` +
          `${getal(rijen[as]!.totM * 1000, 0)} mm`,
        { richting: AS_LABEL[as], as: RIJ_COORDINAAT[as],
          van: getal(rijen[as]!.vanM * 1000, 0), tot: getal(rijen[as]!.totM * 1000, 0) })),
      scheiding: "; ",
    };
    regels.push(vt(`${S}torsionIncluded`,
      "Meegenomen: de torsie door een tegengestelde scheefstand van twee tegenoverliggende gevels " +
        "(EN 1993-1-1 §5.3.2(10), figuur 5.5). Per richting met twee of meer kolomrijen twee " +
        "varianten extra (torsie + en −): een starre verdraaiing van de plattegrond, waarin elke " +
        "verticale last V de horizontale last s·φ·V krijgt, s = 1 − 2·(p − p_van)/(p_tot − p_van), " +
        `met p haaks op de richting en p_van, p_tot de buitenste rijen (${nederlands(lijst)}).`,
      { lijst }));
  } else if (opties.torsie) {
    regels.push(vt(`${S}torsionNoRows`,
      "De torsievariant (EN 1993-1-1 §5.3.2(10)) staat aan, maar geen richting heeft twee of meer " +
        "kolomrijen: er is geen tegenoverliggende gevel om tegengesteld scheef te zetten."));
  } else {
    regels.push(vt(`${S}torsionNotIncluded`,
      "Niet meegenomen: de torsie door een tegengestelde scheefstand van twee tegenoverliggende " +
        "gevels (EN 1993-1-1 §5.3.2(10), figuur 5.5). Is het gebouw daar gevoelig voor (een " +
        "plattegrond met de stabiliteit aan één zijde, of een kleine torsiestijfheid), beoordeel dat " +
        "dan apart."));
  }
  if (uitkomst.waarschuwingTeksten.length > 0) {
    regels.push("");
    for (const w of uitkomst.waarschuwingTeksten) regels.push({ lijst: ["! ", w], scheiding: "" });
  }
  return regels;
}

/**
 * De 3D-afleiding als tekstblok (Nederlands): voor het rapport. Eén bron met
 * de tooltip (`scheefstandToelichting3DVertaald`), zodat scherm en rapport niet
 * uit elkaar kunnen lopen.
 */
export function scheefstandToelichting3D(
  uitkomst: ScheefstandUitkomst3D,
  geometrie: ScheefstandGeometrie3D,
  opties: ToelichtingOpties3D = {},
): string {
  return toelichtingRegels3D(uitkomst, geometrie, opties).map(nederlands).join("\n");
}

/** `scheefstandToelichting3D` in de taal van de interface, voor de tooltip op de φ-knop. */
export function scheefstandToelichting3DVertaald(
  uitkomst: ScheefstandUitkomst3D,
  geometrie: ScheefstandGeometrie3D,
  t: Vertaalfunctie,
  opties: ToelichtingOpties3D = {},
): string {
  return toelichtingRegels3D(uitkomst, geometrie, opties).map((r) => vertaalWaarde(t, r)).join("\n");
}

const RICHTINGEN: readonly { as: OpenFem3DScheefstandAs; richting: 1 | -1; label: string; torsie: boolean }[] = [
  { as: "x", richting: 1, label: "+X", torsie: false },
  { as: "x", richting: -1, label: "−X", torsie: false },
  { as: "y", richting: 1, label: "+Y", torsie: false },
  { as: "y", richting: -1, label: "−Y", torsie: false },
  // De torsievarianten van 5.3.2(10) (issue #212): index 4 t/m 7, dus id +
  // 4…7 · SCHEEFSTAND_COMBO_OFFSET. "+" = de rij op p_van in de +richting.
  { as: "x", richting: 1, label: "torsie +X", torsie: true },
  { as: "x", richting: -1, label: "torsie −X", torsie: true },
  { as: "y", richting: 1, label: "torsie +Y", torsie: true },
  { as: "y", richting: -1, label: "torsie −Y", torsie: true },
];

/** Kort label van een 3D-scheefstandrichting, voor combinatienamen. */
export function scheefstandRichtingLabel3D(as: OpenFem3DScheefstandAs, richting: 1 | -1, torsie = false): string {
  return RICHTINGEN.find((r) => r.as === as && r.richting === richting && r.torsie === torsie)!.label;
}

/**
 * Elke combinatie in vier varianten (+X, −X, +Y, −Y). De variant +X houdt het
 * id van de combinatie; de andere krijgen een veelvoud van
 * `SCHEEFSTAND_COMBO_OFFSET` erbij, net als de tegenrichting in 2D.
 *
 *  - `phi` = φ_X en φ_Y van de berekening; `null` (scheefstand uit) = de lijst
 *    zoals hij is. Een richting met φ = 0 krijgt geen varianten.
 *  - Ontvouwd worden de UGT-combinaties, en met `bgt` ook de BGT (de
 *    resultaten met de schakelaar aan, zoals 2D: issue #194). De UGT-toets
 *    geeft alleen UGT-combinaties.
 *  - Een al ontvouwde combinatie blijft zoals hij is.
 */
export function metScheefstandRichtingen3D(
  combinations: readonly LoadCombination[],
  phi: OpenFem3DPhiPerAs | null,
  opties: {
    bgt?: boolean;
    /**
     * De torsievarianten (5.3.2(10), issue #212): per richting met buitenste
     * rijen (`torsieRijen3D`) twee varianten extra. Ontbreekt = geen.
     */
    torsie?: OpenFem3DTorsiePerAs | null;
  } = {},
): LoadCombination[] {
  if (!phi) return [...combinations];
  const uit: LoadCombination[] = [];
  for (const combinatie of combinations) {
    if ((combinatie.type !== "uls" && !opties.bgt) || combinatie.scheefstandRichting !== undefined) {
      uit.push(combinatie);
      continue;
    }
    const varianten = RICHTINGEN.map((r, index) => ({ ...r, index }))
      .filter((r) => phi[r.as] > 0 && (!r.torsie || opties.torsie?.[r.as] !== undefined));
    if (varianten.length === 0) {
      uit.push(combinatie);
      continue;
    }
    for (const { as, richting, label, index, torsie } of varianten) {
      uit.push({
        ...combinatie,
        id: combinatie.id + index * SCHEEFSTAND_COMBO_OFFSET,
        name: `${combinatie.name} (scheefstand ${label})`,
        scheefstandRichting: richting,
        scheefstandAs: as,
        ...(torsie ? { scheefstandTorsie: true } : {}),
      });
    }
  }
  return uit;
}

/**
 * De basiscombinatie van een ontvouwde variant: zonder richting, met het id
 * en de naam van vóór het ontvouwen. Een niet-ontvouwde combinatie blijft
 * zoals hij is.
 */
export function zonderScheefstandVariant(combinatie: LoadCombination): LoadCombination {
  if (combinatie.scheefstandRichting === undefined) return combinatie;
  const { scheefstandRichting: _r, scheefstandAs: _a, scheefstandTorsie: _t, ...rest } = combinatie;
  const label = scheefstandRichtingLabel3D(
    combinatie.scheefstandAs ?? "x", combinatie.scheefstandRichting, combinatie.scheefstandTorsie === true);
  const achtervoegsel = ` (scheefstand ${label})`;
  return {
    ...rest,
    id: combinatie.id % SCHEEFSTAND_COMBO_OFFSET,
    name: combinatie.name.endsWith(achtervoegsel) ? combinatie.name.slice(0, -achtervoegsel.length) : combinatie.name,
  };
}

/**
 * De scheefstand van een (ontvouwen) combinatie, of null zonder scheefstand.
 * `phi` is φ per richting; één getal geldt voor beide richtingen.
 */
export function scheefstandVanCombinatie(
  combinatie: LoadCombination,
  phi: OpenFem3DPhiPerAs | number | null,
  torsie: OpenFem3DTorsiePerAs | null = null,
  eigenKolom: OpenFem3DEigenKolomPhi | null = null,
): OpenFem3DScheefstand | null {
  if (combinatie.scheefstandRichting === undefined || phi === null) return null;
  const as = combinatie.scheefstandAs ?? "x";
  const waarde = typeof phi === "number" ? phi : phi[as];
  if (!(waarde > 0)) return null;
  const eigen = eigenKolom && eigenKolom.kolommen.length > 0
    ? {
        phiPerStaaf: new Map([...eigenKolom.perStaaf].map(([id, p]) => [id, p[as]])),
        phiPerKnoop: new Map([...eigenKolom.perKnoop].map(([id, p]) => [id, p[as]])),
      }
    : {};
  if (combinatie.scheefstandTorsie) {
    const rijen = torsie?.[as];
    if (!rijen) {
      throw new Error(`Scheefstand: de torsievariant "${combinatie.name}" heeft geen twee kolomrijen haaks op ` +
        `${AS_LABEL[as]} (EN 1993-1-1 5.3.2(10)).`);
    }
    return { phi: waarde, as, richting: combinatie.scheefstandRichting, torsie: rijen, ...eigen };
  }
  return { phi: waarde, as, richting: combinatie.scheefstandRichting, ...eigen };
}

/**
 * Het gelijkwaardige trapezium van het product van twee lineaire verlopen
 * q(t) en s(t) over een deel met t van 0 tot 1: dezelfde resultante en
 * dezelfde werklijn (eerste moment). Met I₀ = ∫q·s dt en I₁ = ∫q·s·t dt is
 * T₁ + T₂ = 2·I₀ en T₁ + 2·T₂ = 6·I₁. Bij een constante s precies (q₁·s, q₂·s).
 * Voor de torsievariant (5.3.2(10)): de last q·s·φ is kwadratisch, het
 * rekencontract kent alleen een trapezium.
 */
export function trapeziumVanProduct(q1: number, q2: number, s1: number, s2: number): [number, number] {
  const dq = q2 - q1, ds = s2 - s1;
  const i0 = q1 * s1 + (q1 * ds + s1 * dq) / 2 + dq * ds / 3;
  const i1 = q1 * s1 / 2 + (q1 * ds + s1 * dq) / 3 + dq * ds / 4;
  return [4 * i0 - 6 * i1, 6 * i1 - 2 * i0];
}

type Vec3 = [number, number, number];

/** Het deel van een rekenverzoek dat de omzetting nodig heeft. */
export interface OpenFem3DScheefstandVerzoek {
  nodes: readonly { id: number; x: number; y: number; z: number }[];
  members: readonly { id: number; startNodeId: number; endNodeId: number; rollAngleRad?: number }[];
  nodalLoads: readonly { id: number; nodeId: number; fx: number; fy: number; fz: number; mx: number; my: number; mz: number }[];
  memberLoads: readonly (
    | {
        id: number; memberId: number;
        qyStartKnPerM: number; qyEndKnPerM: number; qzStartKnPerM: number; qzEndKnPerM: number;
        startPositionM?: number; endPositionM?: number;
        globalDirection?: undefined;
      }
    | {
        /** Globale lijnlast (issue #80): q langs de globale as, per staafmeter of per projectie. */
        id: number; memberId: number; globalDirection: OpenFem3DGlobalDirection;
        qStartKnPerM: number; qEndKnPerM: number; perProjection?: boolean;
        startPositionM?: number; endPositionM?: number;
      }
  )[];
  memberPointLoads: readonly { id: number; memberId: number; pyKn: number; pzKn: number; positionM: number }[];
  /** Vlaklasten op platen, globaal per m² (alleen bij een model met platen). */
  surfaceLoads?: readonly { id: number; plateId: number; qxKnPerM2: number; qyKnPerM2: number; qzKnPerM2: number }[];
}

/**
 * Voeg aan een rekenverzoek de horizontale vervangende lasten φ·V toe.
 *
 *  - Knooplast: F_h = −φ·F_z in de gekozen richting (F_z < 0 is omlaag).
 *  - Staaflast in lokaal y/z: de globale verticale component q_Z geeft
 *    q_h = −φ·q_Z; die wordt terug ontbonden in lokaal y, z en x. Het lokale
 *    y/z-deel gaat als extra staaflast mee; het axiale deel (x), dat het
 *    contract van de kern niet als verdeelde last kent, gaat als knooplast
 *    naar de uiteinden volgens de hefboomregel, zodat resultante én moment
 *    om elk uiteinde kloppen.
 *  - Globale lijnlast (#80) in Z: per staafmeter q_Z = f·q (f = 1, of per
 *    projectie |e_x × Z|) geeft q_h = −φ·q_Z als globale lijnlast per
 *    staafmeter in de gekozen richting, over hetzelfde deel; de kern zet die
 *    om naar de staaf, ook het axiale deel. Een globale X- of Y-last heeft
 *    geen verticale component.
 *  - Puntlast op een staaf: net zo, met het axiale deel naar de uiteinden.
 *
 * De som van alle toegevoegde horizontale krachten is exact φ·ΣV. Bij de
 * torsievariant (`scheefstand.torsie`, 5.3.2(10)) krijgt elke last er de factor
 * s bij (zie de kop); de som is dan Σ s·φ·V, nul bij een symmetrische
 * belasting, en het moment om de verticale as is φ·Σ s·V·(p − p_midden).
 */
export function metScheefstandLasten<T extends OpenFem3DScheefstandVerzoek>(verzoek: T, scheefstand: OpenFem3DScheefstand): T {
  const { phi: phiModel, as, richting, torsie, phiPerStaaf, phiPerKnoop } = scheefstand;
  // φ per last: de eigen scheefstand van een losse kolom (fase 3) vervangt φ
  // van het model voor de lasten op haar staven en knopen; anders φ zelf.
  const phiKnoop = (nodeId: number) => phiPerKnoop?.get(nodeId) ?? phiModel;
  const phiStaaf = (memberId: number) => phiPerStaaf?.get(memberId) ?? phiModel;
  const d: Vec3 = as === "x" ? [richting, 0, 0] : [0, richting, 0];
  const knoop = new Map(verzoek.nodes.map((n) => [n.id, n]));
  // De torsievariant (5.3.2(10)): de factor s op een punt, uit de coördinaat
  // haaks op de richting. Zonder torsie s = 1 en rekent alles hieronder zoals
  // vóór issue #212, tot op het laatste bit.
  const haaks = RIJ_COORDINAAT[as];
  const sOp = (p: { x: number; y: number }): number => torsie
    ? 1 - 2 * (p[haaks] - torsie.vanM) / (torsie.totM - torsie.vanM)
    : 1;
  if (torsie && !(torsie.totM > torsie.vanM)) {
    throw new Error("Scheefstand: de torsievariant heeft twee verschillende buitenste kolomrijen nodig.");
  }
  const staaf = new Map(verzoek.members.map((m) => [m.id, m]));
  const assen = new Map<number, { ex: Vec3; ey: Vec3; ez: Vec3; lengte: number }>();
  const assenVan = (memberId: number) => {
    let a = assen.get(memberId);
    if (!a) {
      const m = staaf.get(memberId);
      if (!m) throw new Error(`Scheefstand: staafbelasting op onbekende staaf ${memberId}.`);
      const s = knoop.get(m.startNodeId)!, e = knoop.get(m.endNodeId)!;
      a = { ...openFem3DMemberAxes(s, e, m.rollAngleRad ?? 0), lengte: Math.hypot(e.x - s.x, e.y - s.y, e.z - s.z) };
      assen.set(memberId, a);
    }
    return a;
  };
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const extraKnoop = new Map<number, Vec3>();
  const telOp = (nodeId: number, f: Vec3) => {
    const huidig = extraKnoop.get(nodeId) ?? [0, 0, 0];
    extraKnoop.set(nodeId, [huidig[0] + f[0], huidig[1] + f[1], huidig[2] + f[2]]);
  };
  const schaal = (v: Vec3, s: number): Vec3 => [v[0] * s, v[1] * s, v[2] * s];

  for (const last of verzoek.nodalLoads) {
    if (last.fz === 0) continue;
    const phi = phiKnoop(last.nodeId);
    const s = torsie ? sOp(knoop.get(last.nodeId)!) : 1;
    telOp(last.nodeId, schaal(d, torsie ? -phi * s * last.fz : -phi * last.fz));
  }
  /** s aan begin en eind van het deel [a, b] van een staaf (lineair langs de staaf). */
  const sLangs = (memberId: number, a: number, b: number): [number, number] => {
    const m = staaf.get(memberId)!;
    const { ex } = assenVan(memberId);
    const p0 = knoop.get(m.startNodeId)!;
    const punt = (t: number) => ({ x: p0.x + ex[0] * t, y: p0.y + ex[1] * t });
    return [sOp(punt(a)), sOp(punt(b))];
  };

  const extraStaaflasten: T["memberLoads"][number][] = [];
  let volgendeStaaflastId = Math.max(0, ...verzoek.memberLoads.map((l) => l.id)) + 1;
  for (const last of verzoek.memberLoads) {
    const { ex, ey, ez, lengte } = assenVan(last.memberId);
    const phi = phiStaaf(last.memberId);
    const a = last.startPositionM ?? 0, b = last.endPositionM ?? lengte;
    if (isOpenFem3DGlobalMemberLoad(last)) {
      if (last.globalDirection !== "z") continue;
      const f = openFem3DGlobalMemberLoadFactor(ex, "z", last.perProjection);
      let h1 = -phi * f * last.qStartKnPerM, h2 = -phi * f * last.qEndKnPerM;
      if (torsie) {
        const [s1, s2] = sLangs(last.memberId, a, b);
        const [t1, t2] = trapeziumVanProduct(f * last.qStartKnPerM, f * last.qEndKnPerM, s1, s2);
        h1 = -phi * t1;
        h2 = -phi * t2;
      }
      if (h1 === 0 && h2 === 0) continue;
      extraStaaflasten.push({
        id: volgendeStaaflastId++, memberId: last.memberId, globalDirection: as,
        qStartKnPerM: richting * h1, qEndKnPerM: richting * h2, startPositionM: a, endPositionM: b,
      } as T["memberLoads"][number]);
      continue;
    }
    // Globale verticale component aan begin en eind van het belaste deel.
    let qZ1 = last.qyStartKnPerM * ey[2] + last.qzStartKnPerM * ez[2];
    let qZ2 = last.qyEndKnPerM * ey[2] + last.qzEndKnPerM * ez[2];
    if (qZ1 === 0 && qZ2 === 0) continue;
    if (torsie) {
      // Het kwadratische verloop q_Z·s als gelijkwaardig trapezium.
      const [s1, s2] = sLangs(last.memberId, a, b);
      [qZ1, qZ2] = trapeziumVanProduct(qZ1, qZ2, s1, s2);
    }
    const h1 = schaal(d, -phi * qZ1), h2 = schaal(d, -phi * qZ2);
    const qy1 = dot(h1, ey), qy2 = dot(h2, ey), qz1 = dot(h1, ez), qz2 = dot(h2, ez);
    if (qy1 !== 0 || qy2 !== 0 || qz1 !== 0 || qz2 !== 0) {
      extraStaaflasten.push({
        ...last, id: volgendeStaaflastId++,
        qyStartKnPerM: qy1, qyEndKnPerM: qy2, qzStartKnPerM: qz1, qzEndKnPerM: qz2,
      });
    }
    // Axiaal deel: trapezium van qx1 naar qx2 over [a, b], als twee knoopkrachten.
    const qx1 = dot(h1, ex), qx2 = dot(h2, ex);
    const resultante = (qx1 + qx2) / 2 * (b - a);
    if (resultante !== 0 && lengte > 0) {
      // Zwaartepunt van het trapezium, gemeten vanaf a.
      const som = qx1 + qx2;
      const xc = som !== 0 ? (b - a) * (qx1 + 2 * qx2) / (3 * som) : (b - a) / 2;
      const positie = a + xc;
      const m = staaf.get(last.memberId)!;
      telOp(m.startNodeId, schaal(ex, resultante * (1 - positie / lengte)));
      telOp(m.endNodeId, schaal(ex, resultante * (positie / lengte)));
    }
  }

  const extraPuntlasten: T["memberPointLoads"][number][] = [];
  let volgendePuntlastId = Math.max(0, ...verzoek.memberPointLoads.map((l) => l.id)) + 1;
  for (const last of verzoek.memberPointLoads) {
    const { ex, ey, ez, lengte } = assenVan(last.memberId);
    const phi = phiStaaf(last.memberId);
    const pZ = last.pyKn * ey[2] + last.pzKn * ez[2];
    if (pZ === 0) continue;
    const h = schaal(d, torsie ? -phi * sLangs(last.memberId, last.positionM, last.positionM)[0] * pZ : -phi * pZ);
    const py = dot(h, ey), pz = dot(h, ez), px = dot(h, ex);
    if (py !== 0 || pz !== 0) extraPuntlasten.push({ ...last, id: volgendePuntlastId++, pyKn: py, pzKn: pz });
    if (px !== 0 && lengte > 0) {
      const m = staaf.get(last.memberId)!;
      telOp(m.startNodeId, schaal(ex, px * (1 - last.positionM / lengte)));
      telOp(m.endNodeId, schaal(ex, px * (last.positionM / lengte)));
    }
  }

  let volgendeKnooplastId = Math.max(0, ...verzoek.nodalLoads.map((l) => l.id)) + 1;
  const extraKnooplasten = [...extraKnoop.entries()]
    .filter(([, f]) => f.some((c) => Math.abs(c) > 0))
    .map(([nodeId, f]) => ({ id: volgendeKnooplastId++, nodeId, fx: f[0], fy: f[1], fz: f[2], mx: 0, my: 0, mz: 0 }));

  // Vlaklast op een plaat (globaal per m²): de horizontale component φ·q_Z per m².
  // De torsievariant zou s·φ·q_Z per plaatpunt vragen; het rekencontract kent
  // per plaat alleen een uniforme vlaklast. Dan liever een weigering met reden.
  if (torsie && verzoek.surfaceLoads?.some((l) => l.qzKnPerM2 !== 0)) {
    throw new Error("Scheefstand: de torsievariant (EN 1993-1-1 5.3.2(10)) is niet beschikbaar voor een " +
      "verticale vlaklast op een plaat; het rekenverzoek kent per plaat alleen een uniforme vlaklast. " +
      "Zet de torsievariant uit of beoordeel de torsie apart.");
  }
  const surfaceLoads = verzoek.surfaceLoads?.map((last) => last.qzKnPerM2 === 0 ? last : {
    ...last,
    qxKnPerM2: last.qxKnPerM2 - phiModel * last.qzKnPerM2 * d[0],
    qyKnPerM2: last.qyKnPerM2 - phiModel * last.qzKnPerM2 * d[1],
  });

  return {
    ...verzoek,
    nodalLoads: [...verzoek.nodalLoads, ...extraKnooplasten],
    memberLoads: [...verzoek.memberLoads, ...extraStaaflasten],
    memberPointLoads: [...verzoek.memberPointLoads, ...extraPuntlasten],
    ...(surfaceLoads ? { surfaceLoads } : {}),
  };
}

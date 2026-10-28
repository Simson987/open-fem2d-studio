/**
 * toetsKrachten.ts — de krachten waarmee de UGT-normtoetsing rekent (issue
 * #199, bouwsteen A): ALTIJD tweede orde (P-Δ) met scheefstand, los van de
 * analyse-instelling en de scheefstandschakelaar van het model.
 *
 * WAT DE NORM VRAAGT (NEN-EN 1993-1-1)
 *
 *  * 5.2.2(3)b en (7)b: een tweede-ordeberekening met de globale imperfecties,
 *    en daarna de staaftoets met de systeemlengte als kniklengte. Dat is de
 *    route die deze module de toets altijd laat volgen.
 *  * 5.3.2: de scheefstand φ = φ₀·α_h·α_m als vervangende horizontale krachten
 *    φ·N_Ed, in de meest ongunstige richting (5.3.2(2)) en in alle relevante
 *    richtingen, één per keer (5.3.2(8)): hier +x en −x.
 *  * 5.2.1(3): de grens α_cr ≥ 10 geldt voor een eerste-ordeberekening. De
 *    toets rekent nooit eerste orde, dus voor de toets vervalt die grens; α_cr
 *    wordt alleen nog bepaald om te melden.
 *
 * WAT DE INSTELLINGEN NOG DOEN
 *
 * "Analyse" en "Scheefstand" bepalen voortaan alleen de RESULTATEN: de
 * momentenlijnen, zakkingen en reacties op het scherm. Een handberekening
 * blijft zo controleerbaar op de eerste-ordewaarden. De toets rekent zelf.
 * Is de resultaatrekengang al P-Δ met de scheefstand aan en dezelfde φ, dan
 * zijn de toetskrachten precies die resultaten (`hergebruikt`): geen extra
 * krachtensom, en met `resultaten.alphaCr` ook geen tweede α_cr-bepaling.
 *
 * WAT DEZE MODULE NIET DOET
 *
 *  - De BGT. Doorbuiging, h/300 en scheurwijdte komen uit de resultaten; de
 *    imperfecties van 5.3 horen bij de UGT. `toetsSet2D` voegt beide sets
 *    samen tot de invoer van de toetsbouwers (de id's botsen niet).
 *  - De fysisch niet-lineaire betonronde. Die is asynchroon (de rekenkern is
 *    een apart proces) en draait in de app op `perCase` van deze uitkomst; bij
 *    het analysetype `tweedeOrdeFysisch` zegt `analyse.soort` dat.
 *  - De UGT-eindtoestandvarianten van hout (E_mean,fin, NEN-EN 1995-1-1
 *    2.3.2.2(2)). Die horen bij een eerste-ordeberekening (2.2.2(1)P) en
 *    vallen in de toets weg, met een melding. De BGT-eindtoestand blijft in de
 *    resultaten.
 *  - Hout volgens de volledige route van NEN-EN 1995-1-1 (E_d = E_mean/γ_M,
 *    boogimperfectie). Hout rekent hier met E_mean mee en houdt 2·L bij een
 *    vrij eind; ook dat staat in de meldingen.
 *
 * Puur: geen React, geen DOM, geen Tauri. De app en de sidecar roepen dezelfde
 * functie aan, zodat de drie wegen dezelfde toetskrachten hebben.
 */
import { ANALYSETYPE_LABEL, type Analysetype, type Beam } from "../components/fem/femTypes";
import type { MultiInput, SolverResult } from "../components/fem/solver/types";
import {
  combineResults,
  metScheefstandRichtingen,
  SCHEEFSTAND_COMBO_OFFSET,
  type LoadCombination,
} from "../components/fem/solver/combinations";
import {
  eersteOrdeCombinatieResultaat,
  getSecondOrderState,
  tweedeOrdePerCombinatie,
} from "../components/fem/solver/engine";
import {
  alphaCrLabel,
  bepaalAlphaCr,
  noemerTekst,
  type AlphaCrUitkomst,
  type StabiliteitVoorToets,
  type ToetsKrachtenOmschrijving,
} from "../components/fem/solver/alphaCr";
import { eersteOrdeResultatenVoorToets } from "./eersteOrdeResultaten";
import { hangendDeel, knoopInPlaat, type PlaatVoorEinden } from "./doorgaandeLijn";
import { plaatMateriaalSoort, type PlaatMateriaalSoort } from "./plaatMateriaal";
import {
  leidScheefstandGeometrieAf,
  phiVolgensNorm,
  SCHEEFSTAND_BRON_LABEL,
  SCHEEFSTAND_NORMEN,
  scheefstandToelichting,
  toepasselijkeScheefstandNormen,
  type ScheefstandBron,
  type ScheefstandGeometrie,
  type ScheefstandNorm,
  type ScheefstandUitkomst,
} from "./scheefstandNorm";

/** Een getal in de Nederlandse schrijfwijze. */
const nl = (v: number, d = 3): string => v.toFixed(d).replace(".", ",");

/**
 * Relatieve marge bij het vergelijken van twee φ's. Dezelfde φ langs twee
 * rekenwegen (φ en 1/(1/φ)) kan een paar bits verschillen; dat mag geen
 * verhoging, waarschuwing of gemist hergebruik opleveren. Ook de toets in 3D
 * (`openFem3dToetsKrachten.ts`) vergelijkt hiermee.
 */
export const TOETS_PHI_MARGE = 1e-9;

// ── De toets-φ ──────────────────────────────────────────────────────────────

/** De scheefstand waarmee de toets rekent. */
export interface ToetsScheefstand {
  /** φ in rad. */
  phi: number;
  /** 1/φ, om te tonen. */
  noemer: number;
  /**
   * Waar φ vandaan komt: de bron van de projectinstelling, of `"en1995"` als
   * hout in het model de φ heeft verhoogd.
   */
  bron: ScheefstandBron;
  /** Wat de gebruiker hierover hoort te weten (Nederlands). Leeg = niets aan de hand. */
  meldingen: string[];
}

/**
 * De φ van de toets, uit de projectinstelling — ook als de schakelaar
 * Scheefstand uit staat.
 *
 *  - φ = 1/noemer van `project` (`bepaalScheefstand`): dezelfde rekenweg als
 *    `bouwMultiInput`, zodat de toets en een resultaatrekengang met de
 *    schakelaar aan tot op de bit dezelfde φ hebben (en de toets die
 *    resultaten kan hergebruiken).
 *  - Hout in het model (`normen` bevat `"en1995"`): minstens de φ van
 *    NEN-EN 1995-1-1 (5.1) met de hoogte van de projectinstelling. Die norm
 *    zegt "behoort minimaal gelijk te zijn aan"; met een melding als dat de φ
 *    verhoogt.
 *  - Een vaste noemer waarvan de φ onder de normafleiding van het model ligt
 *    (het grootste van de toepasselijke normen, met de h en m van het model):
 *    een waarschuwing. De toets rekent dan wel met de ingestelde waarde. Bij
 *    een model zonder hoogte is er geen afleiding om mee te vergelijken.
 *
 * `normen` is `toepasselijkeScheefstandNormen` (2D) of de 3D-tegenhanger: de
 * normen die uit de materialen van het model volgen.
 */
export function bepaalToetsScheefstand(
  project: ScheefstandUitkomst,
  normen: readonly ScheefstandNorm[],
): ToetsScheefstand {
  let phi = 1 / project.noemer;
  let noemer = project.noemer;
  let bron = project.bron;
  const meldingen: string[] = [];

  if (normen.includes("en1995")) {
    const hout = phiVolgensNorm("en1995", project.hoogteM, 1).phi;
    if (hout > phi * (1 + TOETS_PHI_MARGE)) {
      meldingen.push(
        `Scheefstand in de toets verhoogd naar φ = 1/${nl(1 / hout, 0)} volgens NEN-EN 1995-1-1 (5.1) ` +
          `met h = ${nl(project.hoogteM)} m: het model bevat hout, en de projectinstelling ` +
          `(${SCHEEFSTAND_BRON_LABEL[project.bron]}) geeft φ = 1/${nl(noemer, 0)}. Met hout geldt in de toets ` +
          "minstens de φ van NEN-EN 1995-1-1 (5.1).",
      );
      phi = hout;
      noemer = 1 / hout;
      bron = "en1995";
    }
  }

  if (project.bron === "vast" && project.hoogteM > 0 && normen.length > 0) {
    const afleidingen = normen.map((n) => phiVolgensNorm(n, project.hoogteM, project.aantalElementen));
    const hoogste = afleidingen.reduce((a, b) => (b.phi > a.phi ? b : a));
    if (phi < hoogste.phi * (1 - TOETS_PHI_MARGE)) {
      meldingen.push(
        `De scheefstand van de toets, φ = 1/${nl(noemer, 0)}, ligt onder de normafleiding van dit model: ` +
          `φ = 1/${nl(1 / hoogste.phi, 0)} volgens ${SCHEEFSTAND_BRON_LABEL[hoogste.norm]} met ` +
          `h = ${nl(project.hoogteM)} m en m = ${project.aantalElementen}. De toets rekent met de vaste ` +
          "noemer uit de projectinstellingen; kies een normbron of een kleinere noemer.",
      );
    }
  }

  return { phi, noemer, bron, meldingen };
}

/** De norm van een plaatmateriaal, zoals de plaatbouwer de plaat toetst. */
const NORM_VAN_PLAAT: Record<PlaatMateriaalSoort, ScheefstandNorm | null> = {
  staal: "en1993",
  beton: "en1992",
  hout: "en1995",
  // Kruislaaghout is hout: NEN-EN 1995-1-1 (5.1) geldt voor de constructie.
  clt: "en1995",
  vrij: null,
};

/**
 * De normen voor de TOETS-φ in 2D: die van de staven
 * (`toepasselijkeScheefstandNormen`) en die van de platen (wandschijven).
 * Een houten wandschijf wordt volgens EN 1995 getoetst, dus geldt ook voor
 * haar het minimum van NEN-EN 1995-1-1 (5.1) uit `bepaalToetsScheefstand`
 * (B5). Alleen voor de toets: de projectafleiding van de resultaten blijft de
 * normregel van het rapport volgen (de staven), zodat de resultaten niet
 * veranderen.
 */
export function toetsScheefstandNormen(
  beams: Beam[],
  plates: readonly { materiaal?: string }[] = [],
): ScheefstandNorm[] {
  const uit = new Set<ScheefstandNorm>(toepasselijkeScheefstandNormen(beams));
  for (const p of plates) {
    const soort = plaatMateriaalSoort(p.materiaal);
    if (soort === null || soort === "onbekend") continue;
    const norm = NORM_VAN_PLAAT[soort];
    if (norm) uit.add(norm);
  }
  return SCHEEFSTAND_NORMEN.filter((n) => uit.has(n));
}

// ── De eigen scheefstand per losse kolom (fase 3) ───────────────────────────

/** Eén losse kolom met haar eigen scheefstand (issue #199, fase 3). */
export interface EigenKolom2D {
  /** De staven van de kolomlijn. */
  staafIds: number[];
  /**
   * Staven die alleen aan de kolom hangen (de luifel of T: een uitkragende
   * ligger op de kop, `hangendDeel`). Hun lasten gaan via de kolom naar de
   * voet en krijgen dezelfde eigen φ. Ontbreekt = geen.
   */
  aanhangendeStaafIds?: number[];
  /** De knopen boven de voet, ook die van de aanhangende staven: hun knooplasten krijgen de eigen φ. */
  knoopIds: number[];
  /** De hoogte van de kolom (voet tot kop), in m. */
  hoogteM: number;
  /** De norm van haar materiaal. */
  norm: ScheefstandNorm;
  /** φ volgens die norm met h = `hoogteM` en m = 1, in rad. */
  phiEigen: number;
}

const NORM_ARTIKEL: Record<ScheefstandNorm, string> = {
  en1993: "EN 1993-1-1 (5.5)", en1992: "EN 1992-1-1 (5.1)", en1995: "EN 1995-1-1 (5.1)",
};

/**
 * De losse kolommen van een 2D-model en hun eigen scheefstand (issue #199,
 * fase 3; de 2D-tegenhanger van `eigenKolomScheefstand3D`).
 *
 * Een kolomlijn (staven steiler dan 75° die een knoop delen,
 * `leidScheefstandGeometrieAf`) is LOS als geen knoop boven haar voet een
 * oplegging heeft of in of op een plaat ligt (`knoopInPlaat`), en wat er boven
 * de voet aan haar vastzit nergens anders aan hangt (`hangendDeel`): geen
 * oplegging, geen plaat, geen andere kolomlijn. Zo telt ook de luifel- of
 * T-kolom (een uitkragende ligger op de kop) als los; de aanhangende staven
 * krijgen dezelfde eigen φ. Een staaf op bedding telt nooit als losse kolom.
 *
 * φ_eigen volgt de norm van haar materiaal met h = haar eigen hoogte en m = 1
 * (EN 1993-1-1 (5.5), EN 1992-1-1 (5.1), EN 1995-1-1 (5.1)): een kolom met
 * een vrije kop hangt nergens aan en middelt haar scheefstand met niets. De
 * model-φ middelt over alle kolommen (α_m) en de gebouwhoogte (α_h) en is voor
 * zo'n kolom te klein. Een staaf zonder normmateriaal krijgt EN 1993.
 */
export function eigenKolomScheefstand2D(model: {
  nodes: readonly { id: number; x: number; z: number }[];
  beams: readonly Beam[];
  supports: readonly { nodeId: number }[];
  plates?: readonly PlaatVoorEinden[];
}): EigenKolom2D[] {
  const geometrie = leidScheefstandGeometrieAf({
    nodes: [...model.nodes], beams: [...model.beams], supports: [...model.supports],
  });
  const knoop = new Map(model.nodes.map((n) => [n.id, n]));
  const opgelegd = new Set(model.supports.map((s) => s.nodeId));
  const modelVoorTocht = {
    nodes: model.nodes as never, beams: model.beams, supports: model.supports, plates: model.plates,
  };
  // Elke staaf van een kolomlijn: een andere kolomlijn bereiken = geen losse kolom.
  const lijnVan = new Map<number, number>();
  geometrie.kolomlijnen.forEach((l, i) => l.staafIds.forEach((id) => lijnVan.set(id, i)));
  const uit: EigenKolom2D[] = [];
  geometrie.kolomlijnen.forEach((lijn, i) => {
    const eigen = new Set(lijn.staafIds);
    const staven = model.beams.filter((b) => eigen.has(b.id));
    if (staven.length === 0 || staven.some((b) => b.bedding)) return;
    const knopen = [...new Set(staven.flatMap((b) => [b.from, b.to]))];
    const voet = knopen.reduce((l, id) => ((knoop.get(id)?.z ?? Infinity) < (knoop.get(l)?.z ?? Infinity) ? id : l), knopen[0]);
    const boven = knopen.filter((id) => id !== voet);
    // Wat er boven de voet aan de kolom hangt (de luifel of T: een uitkragende
    // ligger op de kop), mag er zitten, zolang het nergens anders aan vastzit:
    // geen oplegging, geen plaat, geen andere kolomlijn (`hangendDeel`). De
    // voet wordt bereikt maar niet doorlopen. Die staven en knopen dragen hun
    // last via de kolom af en krijgen dezelfde eigen φ.
    if (boven.some((id) => opgelegd.has(id))) return;
    const extraStaven = new Set<number>();
    const extraKnopen = new Set<number>(boven);
    for (const id of boven) {
      const deel = hangendDeel(id, modelVoorTocht, eigen, new Set(), new Set([voet]),
        (b) => lijnVan.has(b.id) && lijnVan.get(b.id) !== i);
      if (!deel) return;
      deel.staafIds.forEach((s) => extraStaven.add(s));
      deel.knoopIds.forEach((k) => extraKnopen.add(k));
    }
    // Een knoop boven de voet in een plaat: `hangendDeel` toetst alleen de
    // bereikte knopen, dus de beginknopen hier.
    if (boven.some((id) => {
      const k = knoop.get(id);
      return k !== undefined && knoopInPlaat(k, model.nodes as never, model.plates);
    })) return;
    const hoogteM = (lijn.topZmm - lijn.voetZmm) / 1000;
    if (!(hoogteM > 0)) return;
    const norm = toepasselijkeScheefstandNormen(staven)[0] ?? "en1993";
    const aanhang = [...extraStaven].sort((a, b) => a - b);
    uit.push({
      staafIds: [...lijn.staafIds], knoopIds: [...extraKnopen].sort((a, b) => a - b), hoogteM, norm,
      phiEigen: phiVolgensNorm(norm, hoogteM, 1).phi,
      ...(aanhang.length > 0 ? { aanhangendeStaafIds: aanhang } : {}),
    });
  });
  return uit;
}

/**
 * De φ per staaf en per knoop voor de toetsinvoer: max(φ_model, φ_eigen) op
 * de lasten van elke losse kolom. Vervangen, nooit optellen.
 */
export function eigenKolomPhiKaarten(kolommen: readonly EigenKolom2D[], phiModel: number): {
  perStaaf: Map<number, number>;
  perKnoop: Map<number, number>;
} {
  const perStaaf = new Map<number, number>();
  const perKnoop = new Map<number, number>();
  for (const k of kolommen) {
    const phi = Math.max(phiModel, k.phiEigen);
    for (const id of [...k.staafIds, ...(k.aanhangendeStaafIds ?? [])]) perStaaf.set(id, phi);
    for (const id of k.knoopIds) perKnoop.set(id, phi);
  }
  return { perStaaf, perKnoop };
}

/** De melding over de eigen scheefstand van de losse kolommen, of null zonder losse kolom. */
export function eigenKolomMelding2D(kolommen: readonly EigenKolom2D[], phiModel: number): string | null {
  if (kolommen.length === 0) return null;
  const lijst = kolommen.map((k) =>
    `staaf ${k.staafIds.join("+")}` +
      (k.aanhangendeStaafIds ? ` met de aanhangende staaf ${k.aanhangendeStaafIds.join(", ")}` : "") +
      ` (h = ${nl(k.hoogteM)} m, ${NORM_ARTIKEL[k.norm]}, ` +
      `φ_eigen = 1/${nl(1 / k.phiEigen, 0)}, toegepast φ = 1/${nl(1 / Math.max(phiModel, k.phiEigen), 0)})`);
  return "Eigen scheefstand per losse kolom (issue #199, fase 3): een kolom met een vrije kop hangt nergens aan " +
    "en middelt haar scheefstand met niets; haar lasten krijgen φ = max(φ_model, φ_eigen) met h = haar eigen " +
    `hoogte en m = 1: ${lijst.join("; ")}. Daarmee zit haar zijdelingse knik in de toetskrachten en geldt de ` +
    "systeemlengte (NEN-EN 1993-1-1 5.2.2(7)b).";
}

// ── De toetsrekengang 2D ────────────────────────────────────────────────────

/** De analyse waarmee de toetskrachten zijn bepaald. */
export interface ToetsAnalyse {
  /**
   * Altijd tweede orde. `tweedeOrdeFysisch` alleen als het model dat analysetype
   * heeft: dan hoort de aanroeper de fysisch niet-lineaire betonronde op
   * `perCase` van deze uitkomst te draaien (alleen in de app).
   */
  soort: "tweedeOrdeGeometrisch" | "tweedeOrdeFysisch";
  /** De toets-φ in rad (`bepaalToetsScheefstand`). */
  phi: number;
  /** 1/φ, om te tonen. */
  noemer: number;
  /**
   * Alleen 3D (issue #194): φ_X en φ_Y van de toets, in rad. EN 1993-1-1
   * 5.3.2(3) telt m per rij in het beschouwde vlak, dus elke richting heeft
   * haar eigen φ; ±X rekent met `x`, ±Y met `y`. `phi` en `noemer` zijn dan
   * die van de grootste φ.
   */
  phiPerAs?: { x: number; y: number };
  /** De bron van de toets-φ. */
  bron: ScheefstandBron;
  /** De schakelaar Scheefstand van het model; die geldt alleen voor de resultaten. */
  scheefstandModelAan: boolean;
  /** `true` = de resultaatrekengang was al P-Δ met deze φ; de toetskrachten zijn die resultaten. */
  hergebruikt: boolean;
}

/** Waarom de toets geen krachten heeft. */
export interface ToetsWeigering {
  /** De samenvatting, voor de melding en het rapport. */
  reden: string;
  /** Per mislukte toetscombinatie de reden, met α_cr als die bepaald is. */
  perCombinatie: { id: number; naam: string; reden: string }[];
}

/** De uitkomst van `bepaalToetsKrachten2D`. */
export interface ToetsKrachten2D {
  analyse: ToetsAnalyse;
  /**
   * De perCase-Map van de toetsrekengang, met de tweede-orde-status
   * (`getSecondOrderState`). Bij hergebruik die van de resultaten. Leeg aan
   * gevallen (`tweedeOrdePerCombinatie`): wie de gevallen per stuk nodig
   * heeft, leest ze uit de resultaten.
   */
  perCase: Map<number, SolverResult>;
  /** De UGT-combinaties van de toets: ontvouwd in ±x, zonder eindtoestandvarianten. */
  ugtCombinaties: LoadCombination[];
  /** De toetskrachten, alleen UGT, per combinatie-id. Leeg bij een weigering. */
  combinationResults: Map<number, SolverResult>;
  /** α_cr één keer per basiscombinatie, op de primaire variant. */
  alphaCr: AlphaCrUitkomst[];
  /** `null` = de toets heeft krachten. Anders geen krachten, met de reden. */
  weigering: ToetsWeigering | null;
  /**
   * De eigen scheefstand per losse kolom (issue #199, fase 3), alleen als die
   * aan staat en het model een losse kolom heeft: de kolommen en per staaf de
   * toegepaste φ (voor de φ-eis van een vrij staafeind in de staaltoets).
   */
  eigenKolom?: { kolommen: EigenKolom2D[]; perStaaf: Map<number, number> };
  /** Wat er verder te melden is (Nederlands): hout, de toets-φ, vervallen varianten. */
  meldingen: string[];
}

/** De invoer van `bepaalToetsKrachten2D`. */
export interface ToetsKrachtenInvoer2D {
  /**
   * De invoer van de resultaatrekengang (`bouwMultiInput`). Zijn scheefstand
   * telt niet: de toets zet zijn eigen φ en richting.
   */
  basis: MultiInput;
  /**
   * De actieve combinaties, zoals de resultaatrekengang ze rekent (UGT en BGT,
   * eventueel al ontvouwd). De toets neemt er de UGT uit.
   */
  combinaties: readonly LoadCombination[];
  scheefstand: {
    /** De uitkomst van de projectinstelling (`bepaalScheefstand`), ook met de schakelaar uit. */
    project: ScheefstandUitkomst;
    /** De normen die op het model van toepassing zijn (`toepasselijkeScheefstandNormen`). */
    normen: readonly ScheefstandNorm[];
    /** De primaire richting: die van id, de tegengestelde krijgt id + 1 000 000. */
    richting: 1 | -1;
    /** De schakelaar Scheefstand van het model (voor de resultaten). */
    modelAan: boolean;
    /**
     * De losse kolommen (`eigenKolomScheefstand2D`) als de instelling
     * `scheefstandEigenKolom` aan staat (issue #199, fase 3). Leeg of
     * ontbrekend = overal de toets-φ, zoals vóór fase 3.
     */
    eigenKolommen?: readonly EigenKolom2D[];
  };
  /** Het analysetype van het model, dus van de resultaatrekengang. */
  analysetype: Analysetype;
  /**
   * De resultaatrekengang, om te hergebruiken. Of dat mag, leest deze functie
   * af aan de tweede-orde-status van `perCase` zelf (de φ en de richting
   * waarmee werkelijk is gerekend), niet aan een opgegeven waarde.
   */
  resultaten?: {
    perCase: Map<number, SolverResult>;
    combinationResults: Map<number, SolverResult>;
    /**
     * α_cr van DEZE resultaten (`bepaalAlphaCr` op dezelfde invoer, over de
     * combinaties van de resultaatrekengang), als de aanroeper hem al heeft.
     * Bij hergebruik zijn invoer en normaalkrachten van de toets precies die
     * van de resultaten; dan neemt de toets deze uitkomsten over in plaats van
     * dezelfde bisectie nog eens te doen. Zonder hergebruik, of als er een
     * basiscombinatie ontbreekt, rekent de toets zelf.
     */
    alphaCr?: readonly AlphaCrUitkomst[];
  };
}

/**
 * De Nederlandse vaste melding bij hout in de toets (fase 1 van #199). Ook de
 * toets in 3D (`openFem3dToetsKrachten.ts`) geeft haar.
 */
export const TOETS_HOUT_MELDING =
  "Hout in de toets: de tweede-ordeberekening (P-Δ) rekent de houten staven met E_mean, zonder " +
  "E_d = E_mean/γ_M en zonder boogimperfectie. Dat is niet de volledige route van NEN-EN 1995-1-1 " +
  "(2.2.2(1)P, 5.4.4); daarom houdt een houten staaf met een vrij eind de kniklengte 2·L.";

/**
 * De melding dat UGT-eindtoestandvarianten (E_mean,fin) in de toets vervallen
 * (B10 van #199). Gedeeld met de toets in 3D.
 */
export function eindtoestandVervaltMelding(eindtoestand: readonly Pick<LoadCombination, "name">[]): string {
  return (
    `Vervallen in de toets: ${eindtoestand.length} eindtoestandvariant` +
    `${eindtoestand.length === 1 ? "" : "en"} van UGT-combinaties (` +
    eindtoestand.map((c) => c.name).join("; ") +
    "). De eindstijfheid E_mean,fin (NEN-EN 1995-1-1 2.3.2.2(2)) hoort bij een eerste-ordeberekening " +
    "(2.2.2(1)P); de toets rekent altijd tweede orde. De BGT-eindtoestand blijft in de resultaten. " +
    "LET OP: de krachtsverdeling in de eindtoestand is daarmee in de UGT-toets NIET beoordeeld. In deze " +
    "statisch onbepaalde constructie rekent de toets het hout met E_mean, dus stijver dan met E_mean,fin " +
    "(eindtoestand) en dan met E_d = E_mean/γ_M (tweede orde, 2.2.2(1)P): de staven van staal of beton " +
    "krijgen in de toets daardoor MINDER kracht dan in beide normroutes en kunnen te licht getoetst zijn. " +
    "Beoordeel de krachtsverdeling in de eindtoestand apart; de resultaten tonen de eindtoestandvarianten."
  );
}

/**
 * Imperfectiegevallen (`LoadCase.imperfectie`: de scheefstand als knooplasten,
 * bijvoorbeeld uit een IFC-analysemodel) op factor 0 in de UGT-combinaties van
 * de toets. De toets rekent altijd met de scheefstand van de projectinstelling
 * (B2, NEN-EN 1993-1-1 5.3.2); met het imperfectiegeval erbij telde de
 * scheefstand dubbel. Zo telt hij één keer: die van de toets, in elke
 * richting. De combinaties van de resultaten en de BGT blijven zoals ze zijn.
 * Zonder imperfectiegeval met een factor ≠ 0: dezelfde lijst, geen melding.
 */
export function zetImperfectieGevallenOpNul(
  ugt: readonly LoadCombination[],
  loadCases: readonly { id: number; name: string; imperfectie?: true }[] | undefined,
): { combinaties: LoadCombination[]; melding: string | null } {
  const gevallen = (loadCases ?? []).filter((c) => c.imperfectie === true);
  const ids = new Set(gevallen.map((c) => c.id));
  let geraakt = 0;
  const combinaties = ugt.map((c) => {
    if (![...c.factors].some(([id, f]) => ids.has(id) && f !== 0)) return c;
    geraakt += 1;
    return { ...c, factors: new Map([...c.factors].map(([id, f]) => [id, ids.has(id) ? 0 : f])) };
  });
  if (geraakt === 0) return { combinaties: [...ugt], melding: null };
  return {
    combinaties,
    melding:
      `Imperfectiegeval${gevallen.length === 1 ? "" : "len"} ${gevallen.map((c) => `"${c.name}"`).join(", ")} ` +
      "(de scheefstand als knooplasten) in de UGT-toets op factor 0, in " +
      `${geraakt} van de ${ugt.length} UGT-combinaties: de toets rekent altijd met de scheefstand van de ` +
      "projectinstelling (NEN-EN 1993-1-1 5.3.2), en met het imperfectiegeval erbij telde de scheefstand " +
      "dubbel. De resultaten en de BGT rekenen de combinaties zoals ze in het model staan.",
  };
}

/** De boodschap van een fout, zonder stacktrace. */
function foutTekst(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * De UGT-toetskrachten: tweede orde (P-Δ) met de toets-φ, in +x en −x, per
 * UGT-combinatie apart gerekend.
 *
 *  - Toetscombinaties: de UGT uit `combinaties` zonder eindtoestandvarianten,
 *    ontvouwd met `metScheefstandRichtingen` (dat een al ontvouwde lijst laat
 *    staan).
 *  - Rekenen: een eigen tweede-orde-status (`tweedeOrdePerCombinatie`) met de
 *    toets-φ, zodat nooit een cache wordt gedeeld met invoer met een andere
 *    scheefstand.
 *  - Hergebruik: alleen als de resultaatrekengang tweede orde is, met de
 *    schakelaar aan, dezelfde φ en richting, en zonder UGT-eindtoestandvariant
 *    in de lijst. Dan zijn de toetskrachten de UGT-resultaten zelf.
 *  - Divergentie: faalt de som van een combinatie, dan krijgt de toets een
 *    weigering met per combinatie de reden en heeft hij geen krachten. Er wordt
 *    nooit teruggevallen op eerste orde, en deze functie gooit niet: de
 *    resultaten van de aanroeper blijven staan.
 *  - α_cr: één keer per basiscombinatie, op de primaire variant.
 */
export function bepaalToetsKrachten2D(invoer: ToetsKrachtenInvoer2D): ToetsKrachten2D {
  const { basis, combinaties, scheefstand, analysetype, resultaten } = invoer;
  const ts = bepaalToetsScheefstand(scheefstand.project, scheefstand.normen);
  const meldingen = [...ts.meldingen];
  if (scheefstand.normen.includes("en1995")) meldingen.push(TOETS_HOUT_MELDING);

  // ── De toetscombinaties ──────────────────────────────────────────────────
  const ugt = combinaties.filter((c) => c.type === "uls");
  const eindtoestand = ugt.filter((c) => c.eindtoestand !== undefined);
  if (eindtoestand.length > 0) meldingen.push(eindtoestandVervaltMelding(eindtoestand));
  const ugtCombinaties = metScheefstandRichtingen(
    ugt.filter((c) => c.eindtoestand === undefined),
    true,
    scheefstand.richting,
  );

  // ── Hergebruik of een eigen rekengang ────────────────────────────────────
  // De eigen scheefstand per losse kolom (fase 3): max(φ_toets, φ_eigen) op
  // haar lasten. De resultaten kennen die niet, dus dan geen hergebruik.
  const eigenKolommen = scheefstand.eigenKolommen ?? [];
  const metEigen = eigenKolommen.length > 0;
  const kaarten = metEigen ? eigenKolomPhiKaarten(eigenKolommen, ts.phi) : null;
  if (metEigen) meldingen.push(eigenKolomMelding2D(eigenKolommen, ts.phi)!);

  const resultaatStatus = resultaten ? getSecondOrderState(resultaten.perCase) : undefined;
  const resultaatScheef = resultaatStatus?.input.scheefstand;
  const hergebruikt =
    !metEigen &&
    resultaten !== undefined &&
    analysetype !== "eersteOrde" &&
    scheefstand.modelAan &&
    eindtoestand.length === 0 &&
    resultaatScheef !== undefined &&
    resultaatScheef.richting === scheefstand.richting &&
    Math.abs(resultaatScheef.phi - ts.phi) <= ts.phi * TOETS_PHI_MARGE;

  const toetsInvoer: MultiInput = hergebruikt
    ? resultaatStatus!.input
    : {
        ...basis,
        scheefstand: {
          phi: ts.phi,
          richting: scheefstand.richting,
          ...(kaarten ? { phiPerStaaf: kaarten.perStaaf, phiPerKnoop: kaarten.perKnoop } : {}),
        },
      };
  const perCase = hergebruikt ? resultaten!.perCase : tweedeOrdePerCombinatie(toetsInvoer).perCase;

  // ── Per combinatie apart: een divergerende som raakt de andere niet ──────
  const combinationResults = new Map<number, SolverResult>();
  const mislukt: { id: number; naam: string; reden: string }[] = [];
  for (const c of ugtCombinaties) {
    try {
      const r = (hergebruikt ? resultaten!.combinationResults.get(c.id) : undefined) ?? combineResults(c, perCase);
      combinationResults.set(c.id, r);
    } catch (e) {
      mislukt.push({ id: c.id, naam: c.name, reden: foutTekst(e) });
    }
  }

  // ── α_cr, één keer per basiscombinatie ───────────────────────────────────
  // Bij hergebruik is α_cr van de resultaten al bepaald op dezelfde invoer en
  // dezelfde normaalkrachten: overnemen, niet opnieuw bisecteren.
  const alphaCr = (hergebruikt ? alphaCrUitResultaten(ugtCombinaties, resultaten!.alphaCr) : null)
    ?? alphaCrPerBasiscombinatie(toetsInvoer, ugtCombinaties, combinationResults, perCase);

  // ── Weigering ────────────────────────────────────────────────────────────
  let weigering: ToetsWeigering | null = null;
  if (mislukt.length > 0) {
    const ids = new Set(ugtCombinaties.map((c) => c.id));
    const alphaVan = (id: number): AlphaCrUitkomst | undefined => {
      const basisId = ids.has(id - SCHEEFSTAND_COMBO_OFFSET) ? id - SCHEEFSTAND_COMBO_OFFSET : id;
      return alphaCr.find((u) => u.combinatieId === basisId);
    };
    weigering = {
      reden:
        `De toetskrachten zijn niet te bepalen: de tweede-ordeberekening (P-Δ) met scheefstand ` +
        `φ = 1/${nl(ts.noemer, 0)} faalt in ${mislukt.length} van de ${ugtCombinaties.length} ` +
        "UGT-toetscombinaties. De toets wordt geweigerd; er wordt niet teruggevallen op eerste orde " +
        "(NEN-EN 1993-1-1 5.2.2(7)b vraagt krachten uit een tweede-ordeberekening met imperfecties). " +
        "De resultaten van de berekening blijven staan.",
      perCombinatie: mislukt.map((m) => {
        const u = alphaVan(m.id);
        return {
          ...m,
          reden: u?.status === "bepaald" ? `${m.reden} (${alphaCrLabel(u)})` : m.reden,
        };
      }),
    };
  }

  return {
    analyse: {
      soort: analysetype === "tweedeOrdeFysisch" ? "tweedeOrdeFysisch" : "tweedeOrdeGeometrisch",
      phi: ts.phi,
      noemer: ts.noemer,
      bron: ts.bron,
      scheefstandModelAan: scheefstand.modelAan,
      hergebruikt,
    },
    perCase,
    ugtCombinaties,
    combinationResults: weigering ? new Map() : combinationResults,
    alphaCr,
    weigering,
    meldingen,
    ...(kaarten ? { eigenKolom: { kolommen: [...eigenKolommen], perStaaf: kaarten.perStaaf } } : {}),
  };
}

/**
 * α_cr van de resultaten voor de basiscombinaties van de toets, of `null` als
 * er niets is of een basiscombinatie ontbreekt (dan rekent de toets zelf).
 */
function alphaCrUitResultaten(
  ugtCombinaties: readonly LoadCombination[],
  vanResultaten: readonly AlphaCrUitkomst[] | undefined,
): AlphaCrUitkomst[] | null {
  if (!vanResultaten) return null;
  const ids = new Set(ugtCombinaties.map((c) => c.id));
  const primair = ugtCombinaties.filter((c) => !ids.has(c.id - SCHEEFSTAND_COMBO_OFFSET));
  const uit: AlphaCrUitkomst[] = [];
  for (const c of primair) {
    const u = vanResultaten.find((x) => x.combinatieId === c.id);
    if (!u) return null;
    uit.push(u);
  }
  return uit;
}

/**
 * α_cr per basiscombinatie: op de primaire variant van elk paar (id, niet
 * id + 1 000 000), met de normaalkrachten van de toetsrekengang. Divergeerde
 * die variant, dan met de eerste-ordekrachten van dezelfde combinatie: een
 * divergerende P-Δ heeft geen evenwichtsstand, en α_cr < 1 is dan juist de
 * reden die erbij hoort. Een fout in de bepaling zelf wordt "niet bepaald",
 * met de reden; nooit een uitzondering.
 */
function alphaCrPerBasiscombinatie(
  toetsInvoer: MultiInput,
  ugtCombinaties: readonly LoadCombination[],
  combinationResults: Map<number, SolverResult>,
  perCase: Map<number, SolverResult>,
): AlphaCrUitkomst[] {
  const ids = new Set(ugtCombinaties.map((c) => c.id));
  const primair = ugtCombinaties.filter((c) => !ids.has(c.id - SCHEEFSTAND_COMBO_OFFSET));
  const krachten = new Map<number, SolverResult>();
  for (const c of primair) {
    const r = combinationResults.get(c.id);
    if (r) {
      krachten.set(c.id, r);
      continue;
    }
    try {
      const eersteOrde = eersteOrdeCombinatieResultaat(perCase, c);
      if (eersteOrde) krachten.set(c.id, eersteOrde);
    } catch {
      // Ook eerste orde lukt niet: `bepaalAlphaCr` meldt "geen combinatieresultaat".
    }
  }
  try {
    return bepaalAlphaCr(toetsInvoer, primair, krachten);
  } catch (e) {
    const reden = foutTekst(e);
    return primair.map((c) => ({ combinatieId: c.id, naam: c.name, alphaCr: null, status: "niet_bepaald", reden }));
  }
}

// ── De toetsset voor de bouwers ─────────────────────────────────────────────

/** De invoer van de toetsbouwers in 2D: de UGT uit de toets, de BGT uit de resultaten. */
export interface ToetsSet2D {
  /**
   * De combinaties waarop getoetst wordt, in de volgorde van de resultaatlijst:
   * elke UGT-combinatie vervangen door haar toetsvarianten (+x en −x), zonder
   * eindtoestandvarianten; elke BGT-combinatie (ook de BGT-eindtoestand van
   * hout) zoals de resultaten haar rekenden.
   */
  combinaties: LoadCombination[];
  /** Eén Map: de UGT-toetskrachten en de BGT-resultaten. De id's botsen niet. */
  combinationResults: Map<number, SolverResult>;
  /**
   * De stabiliteit van de TOETS: tweede orde, met scheefstand, de toets-φ en
   * α_cr van de toetsrekengang. Daarmee beslissen de bouwers over de kniklengte
   * bij een vrij eind (`zijdelingseKnikInVlakModel`).
   */
  stabiliteit: StabiliteitVoorToets;
  /**
   * De eerste orde voor de betonkolomtoets (§5.8.3.1, (5.19)): de UGT uit de
   * toetsrekengang, de quasi-blijvende uit de resultaten. Altijd gevuld zodra
   * er een betonstaaf met een §5.8-blok is, want de toetsset is altijd tweede
   * orde (`eersteOrdeResultatenVoorToets`).
   */
  eersteOrdeResultaten?: Map<number, SolverResult>;
}

/**
 * De toetsset: de UGT uit `toets` (tweede orde met scheefstand), de BGT uit de
 * resultaatrekengang (besluit B6 van #199: doorbuiging, h/300 en scheurwijdte
 * horen bij de resultaten, de imperfecties van 5.3 bij de UGT). Alleen voor
 * een toets ZONDER weigering: die heeft geen krachten, en dan is er niets om
 * samen te voegen.
 *
 * De volgorde volgt de resultaatlijst, zodat een model waarvan de resultaten
 * al P-Δ met dezelfde scheefstand zijn (`hergebruikt`) precies de lijst en de
 * krachten van vóór #199 krijgt.
 */
export function toetsSet2D(
  toets: ToetsKrachten2D,
  resultaten: {
    /** De combinaties van de resultaatrekengang (`actieveCombinaties`). */
    combinaties: readonly LoadCombination[];
    combinationResults: Map<number, SolverResult>;
    /** De perCase-Map van de resultaatrekengang, voor de quasi-blijvende eerste orde. */
    perCase: Map<number, SolverResult> | null | undefined;
  },
  beams: readonly Beam[],
): ToetsSet2D {
  if (toets.weigering) {
    throw new Error(`De toets is geweigerd en heeft geen krachten: ${toets.weigering.reden}`);
  }
  const toetsVan = new Map(toets.ugtCombinaties.map((c) => [c.id, c]));
  const combinaties: LoadCombination[] = [];
  const combinationResults = new Map<number, SolverResult>();
  const gezien = new Set<number>();
  const neem = (c: LoadCombination | undefined, r: SolverResult | undefined) => {
    if (!c || gezien.has(c.id)) return;
    gezien.add(c.id);
    combinaties.push(c);
    if (r) combinationResults.set(c.id, r);
  };
  for (const c of resultaten.combinaties) {
    if (c.type === "uls") {
      // De eindtoestandvarianten (E_mean,fin) horen niet in een tweede-orde-
      // toets (B10); `bepaalToetsKrachten2D` meldt dat al.
      if (c.eindtoestand !== undefined) continue;
      const primair = toetsVan.get(c.id);
      neem(primair, toets.combinationResults.get(c.id));
      // Een nog niet ontvouwde combinatie heeft in de toets ook haar
      // tegengestelde richting.
      if (c.scheefstandRichting === undefined) {
        const tegen = toetsVan.get(c.id + SCHEEFSTAND_COMBO_OFFSET);
        neem(tegen, tegen ? toets.combinationResults.get(tegen.id) : undefined);
      }
      continue;
    }
    neem(c, resultaten.combinationResults.get(c.id));
  }
  // Vangnet: een toetscombinatie die niet bij een resultaatcombinatie hoort
  // (dat komt niet voor zolang beide uit dezelfde lijst komen) valt niet weg.
  for (const c of toets.ugtCombinaties) neem(c, toets.combinationResults.get(c.id));

  return {
    combinaties,
    combinationResults,
    stabiliteit: {
      analysetype: toets.analyse.soort,
      alphaCr: toets.alphaCr,
      scheefstandAan: true,
      scheefstandPhi: toets.analyse.phi,
      ...(toets.eigenKolom ? { scheefstandPhiPerStaaf: toets.eigenKolom.perStaaf } : {}),
    },
    eersteOrdeResultaten: eersteOrdeResultatenVoorToets(
      { perCase: toets.perCase, ugtCombinaties: toets.ugtCombinaties },
      resultaten,
      beams,
    ),
  };
}

/** De weigering als één tekst, met per combinatie de reden op een eigen regel. */
export function weigeringTekst(w: ToetsWeigering): string {
  return [w.reden, ...w.perCombinatie.map((p) => `• ${p.naam}: ${p.reden}`)].join("\n");
}

/**
 * De toetskrachten in woorden, voor `analyseToelichting` en de labels op het
 * scherm: het label van de toetsanalyse, de toets-φ en haar bron. Gedeeld door
 * de app (2D en 3D) en de sidecar, zodat scherm, PDF en MCP dezelfde zin hebben.
 */
export function toetsOmschrijving(
  analyse: Pick<ToetsAnalyse, "soort" | "noemer" | "bron" | "hergebruikt">,
  richtingen: "2d" | "3d",
  /** Beton in het model: de regel zegt dan dat 5.2.2(7)b daar niet geldt. */
  metBeton = false,
): ToetsKrachtenOmschrijving {
  return {
    label: ANALYSETYPE_LABEL[analyse.soort],
    noemer: analyse.noemer,
    bronLabel: SCHEEFSTAND_BRON_LABEL[analyse.bron],
    richtingen,
    hergebruikt: analyse.hergebruikt,
    ...(metBeton ? { metBeton: true } : {}),
  };
}

/**
 * De scheefstand als tekstblok voor het rapport, de PDF en de MCP-uitvoer: de
 * afleiding van φ uit de projectinstelling (`scheefstandToelichting`, die ook
 * zegt dat de UGT-toets er altijd mee rekent), en wat de toets daaraan
 * veranderde of opmerkte (`bepaalToetsScheefstand`: hout volgens EN 1995-1-1
 * (5.1), een vaste noemer onder de normwaarde).
 *
 * NOOIT LEEG (issue #199). Tot 2026.42 zweeg het rapport over de scheefstand
 * zolang de schakelaar uit stond: zij zat dan in geen enkele kracht waarop
 * getoetst was. Nu rekent de UGT-toets altijd met deze φ, dus hoort zij altijd
 * bij de uitgangspunten.
 */
export function scheefstandToelichtingToets(
  project: ScheefstandUitkomst,
  geometrie: ScheefstandGeometrie,
  normen: readonly ScheefstandNorm[],
): string {
  const ts = bepaalToetsScheefstand(project, normen);
  const regels = [scheefstandToelichting(project, geometrie)];
  if (ts.meldingen.length > 0) regels.push("", ...ts.meldingen.map((m) => `! ${m}`));
  if (ts.noemer !== project.noemer) regels.push(`De toets rekent daarom met φ = 1/${noemerTekst(ts.noemer)}.`);
  return regels.join("\n");
}

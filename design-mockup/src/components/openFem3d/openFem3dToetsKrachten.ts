/**
 * openFem3dToetsKrachten.ts — de krachten waarmee de UGT-normtoetsing in 3D
 * rekent (issue #199, bouwsteen B): ALTIJD tweede orde (P-Δ) met scheefstand,
 * in +X, −X, +Y en −Y, los van de analyse-instelling en de scheefstand-
 * schakelaar van het model. De 3D-tegenhanger van `lib/toetsKrachten.ts`.
 *
 * WAT DE NORM VRAAGT (NEN-EN 1993-1-1)
 *
 *  * 5.2.2(3)b en (7)b: een tweede-ordeberekening met de globale imperfecties,
 *    en daarna de staaftoets met de systeemlengte als kniklengte.
 *  * 5.3.2: de scheefstand φ als vervangende horizontale krachten φ·N_Ed, in
 *    elke horizontale richting maar in één richting tegelijk (5.3.2(8)): elke
 *    UGT-combinatie in vier varianten (`metScheefstandRichtingen3D`).
 *  * 5.2.1(3): de grens α_cr ≥ 10 geldt voor eerste orde; de toets rekent nooit
 *    eerste orde. α_cr wordt alleen gemeld, één keer per basiscombinatie.
 *
 * WAT DE INSTELLINGEN NOG DOEN
 *
 * "Analyse" en "Scheefstand" bepalen alleen de RESULTATEN (momentenlijnen,
 * zakkingen, reacties). Zijn die al P-Δ met de scheefstand aan en dezelfde φ,
 * dan zijn de toetskrachten precies die resultaten en kost de toets niets
 * extra (`hergebruikt`). Anders rekent de toets zelf: per UGT-variant één
 * P-Δ-berekening met één knikvorm (α_cr).
 *
 * DE BGT komt uit de resultaten (besluit B6): `toetsSet3D` voegt de UGT van de
 * toets en de BGT van de resultaten samen tot de invoer van de toetsbouwers.
 *
 * PLATEN (besluit B8): de 3D-kern kent voor plaatelementen geen geometrische
 * stijfheid. Een model met platen krijgt daarom geen toets maar een weigering
 * met de reden; er wordt nooit teruggevallen op eerste orde.
 *
 * BETON (besluit B11): §5.8 vraagt eerste-orde-momenten (r_m, M₀Ed, M₀Eqp). Is
 * er een betonstaaf met een kolomblok, dan rekent de toets van dezelfde
 * varianten ook de eerste orde (lineair, met dezelfde scheefstand), en de
 * quasi-blijvende combinaties eerste orde. Die gaan als
 * `eersteOrdeResultaten` mee naar de betonbouwer (`first_order_envelope`). Om
 * z haalt de bouwer de globale scheefstand er weer uit (het gemiddelde van de
 * richtingparen, `eersteOrdeZonderScheefstandOmZ`): de kern telt daar de
 * imperfectie e_i en e₂ zelf op.
 *
 * DRIE STAPPEN, zodat de app (die de kern zelf aanroept) en de 3D-MCP-paden
 * (die de verzoeken aan Rust geven en de uitkomsten terugkrijgen) dezelfde
 * functies gebruiken:
 *   1. `planToetsKrachten3D`: welke berekeningen nodig zijn, wat hergebruikt
 *      wordt, en of de toets vooraf geweigerd wordt (platen);
 *   2. de berekeningen zelf, door de aanroeper;
 *   3. `stelToetsKrachten3DSamen`: de toetskrachten, α_cr en de weigering.
 * `bepaalToetsKrachten3D` doet de drie achter elkaar met een rekenfunctie.
 *
 * Puur: geen React, geen DOM, geen Tauri; de kern zit achter de rekenfunctie.
 */
import {
  combinatiesVanSoort,
  SCHEEFSTAND_COMBO_OFFSET,
  zonderBgtEindtoestand,
  type LoadCombination,
} from "../fem/solver/combinations";
import { alphaCrLabel, type AlphaCrUitkomst } from "../fem/solver/alphaCr";
import type { LoadCase } from "../fem/femTypes";
import {
  bepaalToetsScheefstand,
  eindtoestandVervaltMelding,
  TOETS_HOUT_MELDING,
  TOETS_PHI_MARGE,
  zetImperfectieGevallenOpNul,
  type ToetsAnalyse,
  type ToetsWeigering,
} from "../../lib/toetsKrachten";
import {
  SCHEEFSTAND_BRON_LABEL,
  type ScheefstandNorm,
} from "../../lib/scheefstandNorm";
import type { ConsequenceClass } from "../../lib/types/steel/ConsequenceClass";
import type { OpenFem3DModel } from "./openFem3dModel";
import {
  OPEN_FEM_3D_PLATES_NO_SECOND_ORDER,
  type OpenFem3DAnalysisKind,
  type OpenFem3DSolveResult,
} from "./openFem3dSolver";
import {
  metScheefstandRichtingen3D,
  OPEN_FEM_3D_SCHEEFSTAND_ASSEN,
  phiPerAsTekst,
  scheefstandToelichting3D,
  scheefstandVanCombinatie,
  toetsPhiTekst3D,
  zonderScheefstandVariant,
  type OpenFem3DPhiPerAs,
  type OpenFem3DScheefstand,
  type OpenFem3DTorsiePerAs,
  type ScheefstandGeometrie3D,
  type ScheefstandUitkomst3D,
  type ToelichtingOpties3D,
} from "./openFem3dScheefstand";
import type { OpenFem3DCombinationSet } from "./openFem3dSteelCheck";

/** Een getal in de Nederlandse schrijfwijze. */
const nl = (v: number, d = 3): string => v.toFixed(d).replace(".", ",");

/** De invoer van de toets in 3D. */
export interface ToetsKrachtenInvoer3D {
  /** Het rekenmodel van de resultaten (met eigen gewicht en belastingvlakken). */
  model: OpenFem3DModel;
  /**
   * De combinaties zoals de resultaatrekengang ze rekende (eventueel al
   * ontvouwd in ±X/±Y). De toets neemt er de UGT uit, de quasi-blijvende
   * combinaties voor de eerste orde van beton.
   */
  combinaties: readonly LoadCombination[];
  scheefstand: {
    /**
     * De uitkomst van de projectinstelling (`bepaalScheefstand3D`: φ_X en φ_Y
     * met de m van elke richting), ook met de schakelaar uit.
     */
    project: ScheefstandUitkomst3D;
    /** De normen van het model (`toepasselijkeScheefstandNormen3D`). */
    normen: readonly ScheefstandNorm[];
    /** De schakelaar Scheefstand van het model (voor de resultaten). */
    modelAan: boolean;
    /**
     * De torsievarianten van EN 1993-1-1 5.3.2(10) (issue #212): per richting
     * de buitenste kolomrijen (`torsieRijen3D`). `null`/ontbrekend = uit.
     */
    torsie?: OpenFem3DTorsiePerAs | null;
  };
  /**
   * De belastinggevallen, voor de imperfectiegevallen (`LoadCase.imperfectie`):
   * die tellen in de UGT-toets met factor 0 (`zetImperfectieGevallenOpNul`).
   */
  loadCases?: readonly Pick<LoadCase, "id" | "name" | "imperfectie">[];
  /**
   * De resultaatrekengang, om te hergebruiken. Of dat mag, leest deze functie
   * af aan de resultaten zelf: hun analyse (`result.analysis`) en de
   * scheefstand van hun combinaties.
   */
  resultaten?: {
    combinationResults: ReadonlyMap<number, OpenFem3DSolveResult>;
    /** φ_X en φ_Y waarmee de resultaten zijn gerekend; `null` = zonder scheefstand. */
    phi: OpenFem3DPhiPerAs | null;
  };
}

/** Eén berekening die de toets nodig heeft. */
export interface ToetsRun3D {
  /** Uniek binnen het plan: `toets:<id>` of `eersteOrde:<id>`. */
  sleutel: string;
  /** `toets` = de P-Δ-toetskrachten; `eersteOrde` = de eerste orde voor §5.8. */
  soort: "toets" | "eersteOrde";
  combinatie: LoadCombination;
  analyse: OpenFem3DAnalysisKind;
  /** De scheefstand van deze berekening; `null` = zonder (een BGT-combinatie). */
  scheefstand: OpenFem3DScheefstand | null;
  /** 1 bij de toets (α_cr), 0 bij de eerste orde. */
  bucklingModes: number;
}

/** Wat de toets moet rekenen en wat hij hergebruikt. */
export interface ToetsPlan3D {
  analyse: ToetsAnalyse;
  /** De UGT-varianten van de toets: ontvouwd in ±X/±Y, zonder eindtoestandvarianten. */
  ugtCombinaties: LoadCombination[];
  /** De berekeningen die nog moeten gebeuren. Leeg bij volledig hergebruik of een weigering. */
  runs: ToetsRun3D[];
  /** De toetskrachten die uit de resultaten komen (bij `analyse.hergebruikt`). */
  hergebruik: ReadonlyMap<number, OpenFem3DSolveResult>;
  /**
   * De eerste orde voor §5.8: per combinatie-id de uitkomst uit de resultaten
   * (als die al eerste orde met dezelfde scheefstand is) of `null` (dan staat
   * hij in `runs`). `undefined` = niet nodig: geen betonstaaf met kolomblok.
   */
  eersteOrde?: ReadonlyMap<number, OpenFem3DSolveResult | null>;
  /** Vooraf geweigerd (platen): geen runs, geen krachten. */
  weigering: ToetsWeigering | null;
  meldingen: string[];
}

/** De uitkomst van één berekening: het resultaat, of de reden waarom het niet lukte. */
export type ToetsRunUitkomst3D = { resultaat: OpenFem3DSolveResult } | { fout: string };

/** De toetskrachten in 3D. */
export interface ToetsKrachten3D {
  analyse: ToetsAnalyse;
  ugtCombinaties: LoadCombination[];
  /** De toetskrachten, alleen UGT, per combinatie-id. Leeg bij een weigering. */
  combinationResults: Map<number, OpenFem3DSolveResult>;
  /**
   * De eerste orde voor de betonkolomtoets (§5.8): de UGT-varianten van de
   * toets en de quasi-blijvende combinaties. Alleen met een betonstaaf met
   * kolomblok; anders `undefined` (en wordt er niets extra gerekend).
   */
  eersteOrdeResultaten?: Map<number, OpenFem3DSolveResult>;
  /** α_cr één keer per basiscombinatie, uit de +X-variant. */
  alphaCr: AlphaCrUitkomst[];
  /** `null` = de toets heeft krachten. */
  weigering: ToetsWeigering | null;
  meldingen: string[];
  /** Hoeveel berekeningen de toets zelf deed (0 bij volledig hergebruik). */
  berekeningen: number;
}

/** Is de variant een +X-variant (die het id van de basiscombinatie houdt)? */
const isPrimair = (c: LoadCombination): boolean =>
  (c.scheefstandAs ?? "x") === "x" && c.scheefstandRichting === 1 && !c.scheefstandTorsie;

/** Dezelfde scheefstand: as en richting gelijk (ook allebei zonder). */
const zelfdeScheefstand = (a: LoadCombination | undefined, b: LoadCombination): boolean =>
  a !== undefined && a.scheefstandRichting === b.scheefstandRichting
  && (a.scheefstandRichting === undefined || ((a.scheefstandAs ?? "x") === (b.scheefstandAs ?? "x")
    && (a.scheefstandTorsie === true) === (b.scheefstandTorsie === true)));

/** Een betonstaaf met korf en kolomblok: alleen dan leest de kern de eerste orde (§5.8). */
function heeftBetonkolom(model: Pick<OpenFem3DModel, "beams">): boolean {
  return model.beams.some((b) => b.checkConfig?.betonKorf && b.checkConfig?.betonKolom);
}

/** De toets-φ in 3D: per richting, en samengevat. */
export interface ToetsScheefstand3D {
  /** φ_X en φ_Y van de toets, in rad. */
  phiPerAs: OpenFem3DPhiPerAs;
  /** De grootste van de twee, en haar noemer en bron: voor één getal in een tekst. */
  phi: number;
  noemer: number;
  bron: ToetsAnalyse["bron"];
  /** De meldingen van beide richtingen, elk één keer, met de richting erbij als ze verschillen. */
  meldingen: string[];
}

/**
 * De toets-φ in 3D (issue #194): `bepaalToetsScheefstand` per richting, op de
 * uitkomst met de m van die richting. Zonder verhoging door hout precies de φ
 * van de projectinstelling (`project.phi`), zodat toets en resultaten met de
 * schakelaar aan dezelfde lasten hebben. Meldingen die in beide richtingen
 * gelijk zijn, staan er één keer.
 */
export function toetsScheefstand3D(
  project: ScheefstandUitkomst3D,
  normen: readonly ScheefstandNorm[],
): ToetsScheefstand3D {
  const perAs = {} as Record<"x" | "y", { phi: number; noemer: number; bron: ToetsAnalyse["bron"]; meldingen: string[] }>;
  for (const as of OPEN_FEM_3D_SCHEEFSTAND_ASSEN) {
    const u = project[as];
    const ts = bepaalToetsScheefstand(u, normen);
    const verhoogd = ts.phi > u.phi * (1 + TOETS_PHI_MARGE);
    perAs[as] = verhoogd
      ? { phi: ts.phi, noemer: ts.noemer, bron: ts.bron, meldingen: ts.meldingen }
      : { phi: u.phi, noemer: u.noemer, bron: ts.bron, meldingen: ts.meldingen };
  }
  const meldingen: string[] = [];
  for (const as of OPEN_FEM_3D_SCHEEFSTAND_ASSEN) {
    const ander = as === "x" ? perAs.y : perAs.x;
    for (const m of perAs[as].meldingen) {
      const tekst = ander.meldingen.includes(m) ? m : `Richting ${as.toUpperCase()}: ${m}`;
      if (!meldingen.includes(tekst)) meldingen.push(tekst);
    }
  }
  const grootste = perAs.y.phi > perAs.x.phi ? perAs.y : perAs.x;
  return {
    phiPerAs: { x: perAs.x.phi, y: perAs.y.phi },
    phi: grootste.phi,
    noemer: grootste.noemer,
    bron: grootste.bron,
    meldingen,
  };
}

/**
 * De 3D-scheefstand als tekstblok voor het rapport en de MCP-uitvoer: de
 * afleiding van φ_X en φ_Y (`scheefstandToelichting3D`), en wat de toets daaraan
 * veranderde of opmerkte (`toetsScheefstand3D`). Nooit leeg: de UGT-toets
 * rekent altijd met deze scheefstand (issue #199).
 */
export function scheefstandToelichtingToets3D(
  project: ScheefstandUitkomst3D,
  geometrie: ScheefstandGeometrie3D,
  normen: readonly ScheefstandNorm[],
  opties: ToelichtingOpties3D = {},
): string {
  const ts = toetsScheefstand3D(project, normen);
  const regels = [scheefstandToelichting3D(project, geometrie, opties)];
  if (ts.meldingen.length > 0) regels.push("", ...ts.meldingen.map((m) => `! ${m}`));
  const gewijzigd = OPEN_FEM_3D_SCHEEFSTAND_ASSEN.some((as) =>
    Math.abs(ts.phiPerAs[as] - project.phi[as]) > project.phi[as] * TOETS_PHI_MARGE);
  if (gewijzigd) regels.push(`De toets rekent daarom met ${phiPerAsTekst(ts.phiPerAs)}.`);
  return regels.join("\n");
}


/**
 * Stap 1: wat de toets moet rekenen.
 *
 *  - φ per richting (issue #194): φ_X en φ_Y van de projectinstelling, ook
 *    met de schakelaar uit (`toetsScheefstand3D`, B5), elk met hout minstens
 *    de φ van EN 1995 (5.1). Zonder verhoging door hout precies
 *    `project.phi.x` en `project.phi.y`: de φ waarmee de 3D-resultaten rekenen
 *    (App.tsx), zodat toets en resultaten met de schakelaar aan bit voor bit
 *    dezelfde lasten hebben.
 *  - De UGT zonder eindtoestandvarianten, ontvouwd in +X, −X (φ_X), +Y en −Y
 *    (φ_Y).
 *  - Hergebruik als de resultaten van ELKE variant P-Δ zijn, met dezelfde
 *    scheefstand en dezelfde φ_X en φ_Y, en de schakelaar aan staat.
 *  - Een model met platen: geweigerd, zonder één berekening.
 */
export function planToetsKrachten3D(invoer: ToetsKrachtenInvoer3D): ToetsPlan3D {
  const { model, combinaties, scheefstand, resultaten } = invoer;
  const ts = toetsScheefstand3D(scheefstand.project, scheefstand.normen);
  const phiPerAs = ts.phiPerAs;
  const analyse: ToetsAnalyse = {
    soort: "tweedeOrdeGeometrisch",
    phi: ts.phi,
    noemer: ts.noemer,
    phiPerAs,
    bron: ts.bron,
    scheefstandModelAan: scheefstand.modelAan,
    hergebruikt: false,
  };
  const meldingen = [...ts.meldingen];
  if (scheefstand.normen.includes("en1995")) meldingen.push(TOETS_HOUT_MELDING);

  const ugt = combinaties.filter((c) => c.type === "uls");
  const eindtoestand = ugt.filter((c) => c.eindtoestand !== undefined);
  if (eindtoestand.length > 0) meldingen.push(eindtoestandVervaltMelding(eindtoestand));
  // Imperfectiegevallen (de scheefstand al als knooplasten) op factor 0: de
  // toets rekent zelf met de scheefstand.
  const imperfectie = zetImperfectieGevallenOpNul(ugt.filter((c) => c.eindtoestand === undefined), invoer.loadCases);
  if (imperfectie.melding) meldingen.push(imperfectie.melding);
  // De torsievarianten van 5.3.2(10) (issue #212), alleen met de instelling aan
  // en per richting met twee of meer kolomrijen.
  const torsie = scheefstand.torsie ?? null;
  const ugtCombinaties = metScheefstandRichtingen3D(imperfectie.combinaties, phiPerAs, { torsie });
  const torsieAssen = OPEN_FEM_3D_SCHEEFSTAND_ASSEN.filter((as) => torsie?.[as] !== undefined);
  if (torsieAssen.length > 0) {
    meldingen.push(
      `De toets rekent ook de torsievarianten van EN 1993-1-1 5.3.2(10) (figuur 5.5) in ` +
      `${torsieAssen.map((as) => as.toUpperCase()).join(" en ")}: de buitenste kolomrijen tegengesteld ` +
      "scheef, lineair ertussen (twee varianten per richting extra).",
    );
  }

  if ((model.plates?.length ?? 0) > 0) {
    return {
      analyse, ugtCombinaties, runs: [], hergebruik: new Map(), meldingen,
      weigering: {
        reden: `${OPEN_FEM_3D_PLATES_NO_SECOND_ORDER} De toets wordt geweigerd; er wordt niet teruggevallen op ` +
          "eerste orde (NEN-EN 1993-1-1 5.2.2(7)b vraagt krachten uit een tweede-ordeberekening met " +
          "imperfecties). De resultaten van de berekening blijven staan.",
        perCombinatie: [],
      },
    };
  }

  const resultaatCombinatie = new Map(combinaties.map((c) => [c.id, c]));
  const resultaatPhi = resultaten?.phi ?? null;
  const zelfdePhi = resultaatPhi !== null && OPEN_FEM_3D_SCHEEFSTAND_ASSEN.every((as) =>
    resultaatPhi[as] > 0 && Math.abs(resultaatPhi[as] - phiPerAs[as]) <= phiPerAs[as] * TOETS_PHI_MARGE);
  /** Het resultaat van de resultaatrekengang voor variant `v` met analyse `soort`, als dat bruikbaar is. */
  const bruikbaar = (v: LoadCombination, soort: OpenFem3DAnalysisKind): OpenFem3DSolveResult | undefined => {
    const r = resultaten?.combinationResults.get(v.id);
    return r && r.analysis === soort && zelfdeScheefstand(resultaatCombinatie.get(v.id), v)
      && (v.scheefstandRichting === undefined || zelfdePhi) ? r : undefined;
  };

  // Met een imperfectiegeval op factor 0 zijn het andere combinaties dan die
  // van de resultaten: nooit hergebruiken.
  const hergebruikt = scheefstand.modelAan && zelfdePhi && eindtoestand.length === 0
    && imperfectie.melding === null
    && ugtCombinaties.every((v) => bruikbaar(v, "p-delta") !== undefined);
  analyse.hergebruikt = hergebruikt;
  const hergebruik = new Map<number, OpenFem3DSolveResult>();
  const runs: ToetsRun3D[] = [];
  for (const v of ugtCombinaties) {
    if (hergebruikt) {
      hergebruik.set(v.id, bruikbaar(v, "p-delta")!);
      continue;
    }
    runs.push({
      sleutel: `toets:${v.id}`, soort: "toets", combinatie: v, analyse: "p-delta",
      scheefstand: scheefstandVanCombinatie(v, phiPerAs, torsie), bucklingModes: 1,
    });
  }

  let eersteOrde: Map<number, OpenFem3DSolveResult | null> | undefined;
  if (heeftBetonkolom(model)) {
    eersteOrde = new Map();
    // De quasi-blijvende combinaties ZONDER scheefstand, ook als de resultaten
    // de BGT ontvouwd hebben (schakelaar aan, issue #194): §5.8 leest hier de
    // eerste orde van de combinatie zelf, zoals vóór de BGT-scheefstand.
    const basisBgt = new Map<number, LoadCombination>();
    for (const c of combinaties.filter((c) => c.type === "sls")) {
      const basis = zonderScheefstandVariant(c);
      if (!basisBgt.has(basis.id)) basisBgt.set(basis.id, basis);
    }
    const quasi = combinatiesVanSoort(zonderBgtEindtoestand([...basisBgt.values()]), "6.16b");
    for (const c of [...ugtCombinaties, ...quasi]) {
      const r = bruikbaar(c, "linear");
      eersteOrde.set(c.id, r ?? null);
      if (r) continue;
      runs.push({
        sleutel: `eersteOrde:${c.id}`, soort: "eersteOrde", combinatie: c, analyse: "linear",
        scheefstand: scheefstandVanCombinatie(c, phiPerAs, torsie), bucklingModes: 0,
      });
    }
  }

  return { analyse, ugtCombinaties, runs, hergebruik, ...(eersteOrde ? { eersteOrde } : {}), weigering: null, meldingen };
}

/** α_cr van een uitkomst: de eerste knikvorm, of niet bepaald met de reden. */
function alphaCrVan(c: LoadCombination, r: OpenFem3DSolveResult | undefined, fout?: string): AlphaCrUitkomst {
  const basis = { combinatieId: c.id, naam: c.name };
  if (!r) return { ...basis, alphaCr: null, status: "niet_bepaald", reden: fout ?? "geen toetsresultaat" };
  const knik = r.buckling;
  const factor = knik?.status === "available" ? knik.modes[0]?.loadFactor : undefined;
  if (factor !== undefined && Number.isFinite(factor)) return { ...basis, alphaCr: factor, status: "bepaald" };
  const reden = knik && knik.status !== "available" ? knik.reason : "de kern gaf geen knikvorm";
  return { ...basis, alphaCr: null, status: "niet_bepaald", reden };
}

/**
 * Stap 3: de toetskrachten uit het plan en de uitkomsten van zijn runs
 * (gesleuteld op `run.sleutel`). Gooit niet: een mislukte berekening, een
 * toetsresultaat dat niet P-Δ is of een globaal evenwicht dat niet sluit,
 * maakt de toets een weigering met de reden per combinatie.
 */
export function stelToetsKrachten3DSamen(
  plan: ToetsPlan3D,
  uitkomsten: ReadonlyMap<string, ToetsRunUitkomst3D>,
): ToetsKrachten3D {
  const leeg = (weigering: ToetsWeigering, alphaCr: AlphaCrUitkomst[] = []): ToetsKrachten3D => ({
    analyse: plan.analyse, ugtCombinaties: plan.ugtCombinaties, combinationResults: new Map(),
    alphaCr, weigering, meldingen: plan.meldingen, berekeningen: 0,
  });
  if (plan.weigering) return leeg(plan.weigering);

  const mislukt: { id: number; naam: string; reden: string }[] = [];
  const lees = (sleutel: string, c: LoadCombination, soort: OpenFem3DAnalysisKind, wat: string): OpenFem3DSolveResult | undefined => {
    const u = uitkomsten.get(sleutel);
    if (!u) {
      mislukt.push({ id: c.id, naam: c.name, reden: `${wat}: de berekening ontbreekt` });
      return undefined;
    }
    if ("fout" in u) {
      mislukt.push({ id: c.id, naam: c.name, reden: `${wat}: ${u.fout}` });
      return undefined;
    }
    const r = u.resultaat;
    if (r.analysis !== soort) {
      mislukt.push({ id: c.id, naam: c.name, reden: `${wat}: de kern rekende ${r.analysis} in plaats van ${soort}` });
      return undefined;
    }
    if (r.forceBalance?.ok === false) {
      mislukt.push({
        id: c.id, naam: c.name,
        reden: `${wat}: het globale evenwicht sluit niet (kracht maximaal ${nl(r.forceBalance.maxImbalanceKn)} kN, ` +
          `moment maximaal ${nl(r.forceBalance.maxMomentImbalanceKnm ?? 0)} kNm)`,
      });
      return undefined;
    }
    return r;
  };

  const combinationResults = new Map<number, OpenFem3DSolveResult>();
  const foutVan = new Map<number, string>();
  for (const v of plan.ugtCombinaties) {
    const r = plan.hergebruik.get(v.id) ?? lees(`toets:${v.id}`, v, "p-delta", "P-Δ");
    if (r) combinationResults.set(v.id, r);
    else foutVan.set(v.id, mislukt[mislukt.length - 1]?.reden ?? "");
  }

  let eersteOrdeResultaten: Map<number, OpenFem3DSolveResult> | undefined;
  if (plan.eersteOrde) {
    eersteOrdeResultaten = new Map();
    const naar = new Map([...plan.ugtCombinaties, ...plan.runs.map((r) => r.combinatie)].map((c) => [c.id, c]));
    for (const [id, bekend] of plan.eersteOrde) {
      const c = naar.get(id);
      const r = bekend ?? (c ? lees(`eersteOrde:${id}`, c, "linear", "eerste orde (§5.8)") : undefined);
      if (r) eersteOrdeResultaten.set(id, r);
    }
  }

  // α_cr per basiscombinatie: de +X-variant houdt het id van de basis.
  const alphaCr = plan.ugtCombinaties.filter(isPrimair)
    .map((c) => alphaCrVan(c, combinationResults.get(c.id), foutVan.get(c.id)));

  const berekeningen = plan.runs.length;
  if (mislukt.length > 0) {
    const basisVan = (id: number) => alphaCr.find((u) => u.combinatieId === id % SCHEEFSTAND_COMBO_OFFSET);
    const aantalToets = plan.ugtCombinaties.length;
    const weigering: ToetsWeigering = {
      reden:
        `De toetskrachten zijn niet te bepalen: de tweede-ordeberekening (P-Δ) met scheefstand ` +
        `${toetsPhiTekst3D(plan.analyse)} in +X, −X, +Y en −Y` +
        `${plan.ugtCombinaties.some((c) => c.scheefstandTorsie) ? " (met de torsievarianten van 5.3.2(10))" : ""} faalt in ${mislukt.length} van de ` +
        `${aantalToets + (plan.eersteOrde?.size ?? 0)} toetsberekeningen. De toets wordt geweigerd; er wordt ` +
        "niet teruggevallen op eerste orde (NEN-EN 1993-1-1 5.2.2(7)b vraagt krachten uit een " +
        "tweede-ordeberekening met imperfecties). De resultaten van de berekening blijven staan.",
      perCombinatie: mislukt.map((m) => {
        const u = basisVan(m.id);
        return { ...m, reden: u?.status === "bepaald" ? `${m.reden} (${alphaCrLabel(u)})` : m.reden };
      }),
    };
    return { ...leeg(weigering, alphaCr), berekeningen };
  }

  return {
    analyse: plan.analyse,
    ugtCombinaties: plan.ugtCombinaties,
    combinationResults,
    ...(eersteOrdeResultaten ? { eersteOrdeResultaten } : {}),
    alphaCr,
    weigering: null,
    meldingen: plan.meldingen,
    berekeningen,
  };
}

/**
 * De toets in 3D van begin tot eind: plannen, de runs met `reken` (allemaal
 * tegelijk, zoals de app de resultaten rekent), samenstellen. Gooit niet om
 * een mislukte run: die wordt een weigering. De resultaten van de aanroeper
 * worden niet aangeraakt.
 */
export async function bepaalToetsKrachten3D(
  invoer: ToetsKrachtenInvoer3D,
  reken: (run: ToetsRun3D) => Promise<OpenFem3DSolveResult>,
): Promise<ToetsKrachten3D> {
  const plan = planToetsKrachten3D(invoer);
  const klaar = await Promise.allSettled(plan.runs.map((run) => reken(run)));
  const uitkomsten = new Map<string, ToetsRunUitkomst3D>(plan.runs.map((run, i) => {
    const k = klaar[i];
    return [run.sleutel, k.status === "fulfilled"
      ? { resultaat: k.value }
      : { fout: k.reason instanceof Error ? k.reason.message : String(k.reason) }];
  }));
  return stelToetsKrachten3DSamen(plan, uitkomsten);
}

/**
 * De toetsset voor de 3D-bouwers: de UGT uit de toets (tweede orde met
 * scheefstand), de BGT uit de resultaten (besluit B6), in de volgorde van de
 * resultaatlijst met elke UGT-combinatie vervangen door haar vier
 * toetsvarianten. `scheefstandPhi` is altijd de toets-φ, per richting. Alleen voor een toets
 * zonder weigering.
 */
export function toetsSet3D(
  toets: ToetsKrachten3D,
  resultaten: {
    combinaties: readonly LoadCombination[];
    combinationResults: ReadonlyMap<number, OpenFem3DSolveResult>;
    loadCases?: readonly Pick<LoadCase, "id" | "type">[];
    consequenceClass?: ConsequenceClass;
  },
): OpenFem3DCombinationSet {
  if (toets.weigering) {
    throw new Error(`De toets is geweigerd en heeft geen krachten: ${toets.weigering.reden}`);
  }
  const toetsVan = new Map(toets.ugtCombinaties.map((c) => [c.id, c]));
  const combinations: LoadCombination[] = [];
  const results = new Map<number, OpenFem3DSolveResult>();
  const gezien = new Set<number>();
  const neem = (c: LoadCombination | undefined, r: OpenFem3DSolveResult | undefined) => {
    if (!c || gezien.has(c.id)) return;
    gezien.add(c.id);
    combinations.push(c);
    if (r) results.set(c.id, r);
  };
  for (const c of resultaten.combinaties) {
    if (c.type === "uls") {
      // De eindtoestandvarianten horen niet in een tweede-ordetoets (B10).
      if (c.eindtoestand !== undefined) continue;
      const ids = c.scheefstandRichting === undefined
        ? [0, 1, 2, 3].map((k) => c.id + k * SCHEEFSTAND_COMBO_OFFSET)
        : [c.id];
      for (const id of ids) neem(toetsVan.get(id), toets.combinationResults.get(id));
      continue;
    }
    neem(c, resultaten.combinationResults.get(c.id));
  }
  // Vangnet: een toetsvariant die niet bij een resultaatcombinatie hoort, valt niet weg.
  for (const c of toets.ugtCombinaties) neem(c, toets.combinationResults.get(c.id));
  return {
    combinations,
    results,
    ...(resultaten.loadCases ? { loadCases: resultaten.loadCases } : {}),
    ...(resultaten.consequenceClass ? { consequenceClass: resultaten.consequenceClass } : {}),
    scheefstandPhi: toets.analyse.phiPerAs ?? toets.analyse.phi,
    toetsAnalyse: toets.analyse,
    ...(toets.eersteOrdeResultaten ? { eersteOrdeResultaten: toets.eersteOrdeResultaten } : {}),
  };
}

/**
 * De notitie bij de toetsinvoer: waar de UGT-krachten vandaan komen. Staat bij
 * elke 3D-staaf in de toets, per materiaal:
 *  - staal (en zonder materiaal, de modelbrede toelichting van MCP): de
 *    systeemlengte als kniklengte volgens NEN-EN 1993-1-1 5.2.2(7)b;
 *  - beton: die staalregel geldt niet. De P-Δ rekent met de ongescheurde
 *    elastische stijfheid, dus niet volgens §5.8 (nominale stijfheid of
 *    kromming); de poort λ/λ_lim en §5.8 blijven ongewijzigd en l₀ volgt
 *    §5.8.3.2 uit de kolominvoer (fase 5 van #199).
 */
export function toetsKrachtenNotitie3D(analyse: ToetsAnalyse, materiaal: "staal" | "beton" = "staal"): string {
  const herkomst =
    `De UGT-krachten van deze toets zijn tweede orde (P-Δ) met scheefstand ${toetsPhiTekst3D(analyse)} ` +
    `(${SCHEEFSTAND_BRON_LABEL[analyse.bron]}) in +X, −X, +Y en −Y, één richting per berekening ` +
    "(NEN-EN 1993-1-1 5.2.2(3)b en 5.3.2), los van de analyse-instelling van de resultaten" +
    (analyse.hergebruikt ? " (hier dezelfde berekening als de resultaten)" : "") + ".";
  if (materiaal === "beton") {
    return (
      `${herkomst} Voor beton rekent die P-Δ met de ongescheurde elastische stijfheid (E_cm·I_c): dat ` +
      "is geen tweede-ordeberekening volgens NEN-EN 1992-1-1 §5.8 (nominale stijfheid §5.8.7 of nominale " +
      "kromming §5.8.8). De poort λ/λ_lim en §5.8 blijven daarom ongewijzigd, en de kniklengte l₀ volgt " +
      "§5.8.3.2 uit de kolominvoer; de staalregel 5.2.2(7)b (systeemlengte) geldt voor beton niet. De " +
      "BGT-toetsen komen uit de resultaten."
    );
  }
  return (
    `${herkomst} Daarom mag de staaftoets de systeemlengte als kniklengte nemen (5.2.2(7)b). De BGT-toetsen ` +
    "komen uit de resultaten."
  );
}

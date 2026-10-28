/**
 * API-commando's voor het project: lezen, een nieuw project, en de gedeelde
 * belastinggevallen en combinaties (2D en 3D gebruiken dezelfde lijst).
 *
 * Gevallen en combinaties lopen via `lib/combinatieBeheer.ts`, precies als
 * de store van de app: de standaardcombinaties volgen elke wijziging aan de
 * gevallen, een verwijderd geval verdwijnt uit elke factortabel, en id's
 * lopen via tellers die nooit teruglopen (`idTellers` in het bestand).
 * Verdwijnt het geval met het eigen gewicht, dan gaat het eigen gewicht uit,
 * met een melding (`eigenGewichtNaGevalWijziging`, net als de store).
 */
import { ApiFout } from "../register";
import { documentCommando, nietGevonden } from "../commandoHulp";
import { leegDocument, model3dVan, type ApiDocument } from "../projectDocument";
import { geheel, getal, id, jaNee, keuze, lijst, obj, ofNull, tekst } from "../schemaBouw";
import { SCHEEFSTAND_BRONNEN, type ScheefstandBron } from "../../lib/scheefstandNorm";
import { combinationsFromFile, combinationsToFile } from "../../io/projectFile";
import {
  beoordeelCombinatiesBijOpenen, bevestigEigenFactoren, gevolgklasseBijOpenen, openCombinatieStaat, trekBevestigingIn,
  vervangDoorStandaard, verwijderBelastinggeval, verwijderCombinatie, voegBelastinggevalToe, voegCombinatieToe,
  wijzigBelastinggeval, wijzigCombinatie, type CombinatieStaat, type CombinatieVervanging,
} from "../../lib/combinatieBeheer";
import { eigenGewichtNaGevalWijziging } from "../../lib/eigenGewicht";
import { STANDAARD_GEVOLGKLASSE, type Gevolgklasse } from "../../components/fem/solver/normcombinaties";
import { bijlageUitBestand, STANDAARD_BIJLAGE } from "../../lib/normAanduidingen";
import { openFem3DLoadCaseId, type OpenFem3DModel } from "../../components/openFem3d/openFem3dModel";
import type { GebruiksCategorie, LoadCase } from "../../components/fem/femTypes";
import type { LoadCombination } from "../../components/fem/solver/combinations";

const GEVOLGKLASSEN: readonly Gevolgklasse[] = ["CC1", "CC2", "CC3"];
const GEVALTYPEN: LoadCase["type"][] = ["dead", "live", "snow", "wind", "other"];
const CATEGORIEEN: GebruiksCategorie[] = ["A", "B", "C", "C-menigte", "D", "E", "F", "G", "H", "industrie-kort", "industrie-lang"];

// ── Combinatiestaat uit en naar het document ─────────────────────────────

interface Uitgangspunten { gevolgklasse?: unknown; nationaleBijlage?: unknown }

/**
 * De combinatiestaat van het document, via `openCombinatieStaat`: dezelfde
 * regel als het openen in de app (en de sidecar). Meldingen van die regel
 * (vervangen standaardset, afwijkingen) komen mee.
 */
export function combinatieStaatVan(document: ApiDocument): {
  staat: CombinatieStaat; meldingen: string[]; vervanging: CombinatieVervanging | null;
} {
  const combinaties = combinationsFromFile(document.combinations);
  const uitgangspunten = (document.projectInfo as { uitgangspunten?: Uitgangspunten } | undefined)?.uitgangspunten;
  const uitBestand = GEVOLGKLASSEN.includes(uitgangspunten?.gevolgklasse as Gevolgklasse)
    ? uitgangspunten!.gevolgklasse as Gevolgklasse : null;
  const { klasse } = gevolgklasseBijOpenen({
    bestand: uitBestand, verzoek: null, combinations: combinaties ?? null, terugval: STANDAARD_GEVOLGKLASSE,
  });
  let bijlage;
  try {
    bijlage = bijlageUitBestand(uitgangspunten?.nationaleBijlage) ?? STANDAARD_BIJLAGE;
  } catch (fout) {
    throw new ApiFout("GEWEIGERD", fout instanceof Error ? fout.message : String(fout));
  }
  const { staat, afwijking, vervanging } = openCombinatieStaat({
    loadCases: document.loadCases, combinations: combinaties, gevolgklasse: klasse, bijlage, idTellers: document.idTellers,
    loads: document.loads,
  });
  return {
    staat,
    meldingen: [vervanging?.samenvatting, afwijking?.samenvatting].filter((x): x is string => typeof x === "string" && x !== ""),
    vervanging,
  };
}

/**
 * De meldingen NA een bevestiging of intrekking (issue #196): wat het lezen
 * verving, en wat er dan nog over blijvende factoren te melden is. De melding
 * van vóór de handeling terugsturen zou een cliënt zeggen dat er nog iets mis
 * is terwijl het net is opgelost.
 */
function meldingenNa(staat: CombinatieStaat, vervanging: CombinatieVervanging | null): string[] {
  const afwijking = beoordeelCombinatiesBijOpenen({
    combinations: staat.combinations, loadCases: staat.loadCases, bijlage: staat.bijlage,
  });
  return [vervanging?.samenvatting, afwijking?.samenvatting].filter((x): x is string => typeof x === "string" && x !== "");
}

export function metCombinatieStaat(document: ApiDocument, staat: CombinatieStaat): ApiDocument {
  return {
    ...document,
    loadCases: staat.loadCases,
    combinations: combinationsToFile(staat.combinations),
    idTellers: { belastinggeval: staat.volgendGevalId, combinatie: staat.volgendCombinatieId },
  };
}

/** Het eigen gewicht uit als het gekenmerkte geval verdween, met de melding erbij. */
function metEigenGewichtRegel(
  document: ApiDocument, voor: readonly LoadCase[], meldingen: string[],
): ApiDocument {
  const gevolg = eigenGewichtNaGevalWijziging({ voor, na: document.loadCases, selfWeightEnabled: document.selfWeightEnabled });
  if (!gevolg) return document;
  meldingen.push(gevolg.reden === "verwijderd"
    ? `Het geval "${gevolg.geval.name}" met het eigen gewicht is verwijderd; het eigen gewicht staat uit.`
    : `Het geval "${gevolg.geval.name}" is niet meer blijvend; het eigen gewicht staat uit.`);
  return { ...document, selfWeightEnabled: false };
}

const combinatieUit = (combinatie: LoadCombination) => combinationsToFile([combinatie])[0];

function vindGeval(document: ApiDocument, caseId: number) {
  const geval = document.loadCases.find((lc) => lc.id === caseId);
  if (!geval) throw nietGevonden("Belastinggeval", caseId);
  return geval;
}

function factorenNaarMap(document: ApiDocument, factors: { caseId: number; factor: number }[]): Map<number, number> {
  const map = new Map<number, number>();
  for (const { caseId, factor } of factors) {
    vindGeval(document, caseId);
    if (map.has(caseId)) throw new ApiFout("INVOER_ONGELDIG", `Belastinggeval ${caseId} staat twee keer in de factoren.`);
    map.set(caseId, factor);
  }
  return map;
}

function formuleVoor(document: ApiDocument, factors: Map<number, number>): string {
  return [...factors].map(([caseId, factor]) => `${factor}·${vindGeval(document, caseId).name}`).join(" + ");
}

/** 3D-lasten van een geval; een last zonder caseId hoort bij geval 1. */
function zonder3DLastenVanGeval(model: OpenFem3DModel, caseId: number): { model: OpenFem3DModel; aantal: number } {
  let aantal = 0;
  const filter = <T extends { caseId?: number }>(items: T[] | undefined): T[] | undefined => {
    if (!items) return items;
    const over = items.filter((item) => openFem3DLoadCaseId(item) !== caseId);
    aantal += items.length - over.length;
    return over;
  };
  return {
    model: {
      ...model,
      loads: filter(model.loads), memberLoads: filter(model.memberLoads), memberPointLoads: filter(model.memberPointLoads),
      thermalLoads: filter(model.thermalLoads), surfaceLoads: filter(model.surfaceLoads), loadPanels: filter(model.loadPanels),
    },
    aantal,
  };
}

// ── Schemadelen ───────────────────────────────────────────────────────────

const gevalType = keuze(GEVALTYPEN, "dead = blijvend; live = gebruiksbelasting; snow; wind; other.");
const categorie = keuze(CATEGORIEEN, "Gebruikscategorie (NB tabel NB.2–A1.1), alleen bij type live; ontbreekt = A.");
const factoren = lijst(obj({ caseId: id("Bestaand belastinggeval."), factor: getal("Factor.") }, ["caseId", "factor"]),
  "Factor per belastinggeval; een niet genoemd geval telt niet mee.", { minItems: 1 });

// ── Commando's ────────────────────────────────────────────────────────────

const projectLezen = documentCommando<Record<string, never>, unknown>({
  naam: "project.get",
  beschrijving: "Het project in het kort: dimensie, analysetype, eigen gewicht, actief geval, de belastinggevallen en combinaties, en de aantallen.",
  invoer: obj({}),
  uitvoeren: (_invoer, document) => {
    const { staat, meldingen } = combinatieStaatVan(document);
    const model = model3dVan(document);
    return {
      uitkomst: {
        modelDimension: document.modelDimension ?? (document.model3d ? "3d" : "2d"),
        analysetype: document.analysetype ?? null,
        selfWeightEnabled: document.selfWeightEnabled,
        activeLoadCaseId: document.activeLoadCaseId,
        loadCases: staat.loadCases,
        combinations: combinationsToFile(staat.combinations),
        counts2d: { nodes: document.nodes.length, beams: document.beams.length, plates: document.plates.length, loads: document.loads.length },
        counts3d: { nodes: model.nodes.length, beams: model.beams.length, plates: (model.plates ?? []).length },
        meldingen,
      },
    };
  },
});

const projectNieuw = documentCommando<{ discardChanges?: boolean }, unknown>({
  naam: "project.new",
  beschrijving: "Een nieuw, leeg 3D-project met de standaardgevallen (zoals Bestand → Nieuw); vervangt het huidige project. In de app zonder bestand; heeft het huidige project daar niet-opgeslagen wijzigingen, dan weigert de app, tenzij discardChanges true is.",
  invoer: obj({
    discardChanges: jaNee("Alleen in de app: ook als het huidige project niet-opgeslagen wijzigingen heeft; die gaan verloren."),
  }),
  uitvoeren: () => {
    const document = leegDocument();
    return { uitkomst: { modelDimension: document.modelDimension, loadCases: document.loadCases }, document, nieuwProject: true };
  },
});

const gevalToevoegen = documentCommando<{ name: string; type: LoadCase["type"]; categorie?: GebruiksCategorie }, unknown>({
  naam: "project.loadCase.add",
  beschrijving: "Een belastinggeval toevoegen. De standaardcombinaties nemen het meteen mee (blijvend met γ_G, veranderlijk als leidende en begeleidende last).",
  invoer: obj({ name: tekst("Naam, bijv. \"Sneeuw (S)\".", { minLength: 1 }), type: gevalType, categorie }, ["name", "type"]),
  uitvoeren: ({ name, type, categorie: cat }, document) => {
    const { staat, meldingen } = combinatieStaatVan(document);
    if (cat !== undefined && type !== "live") throw new ApiFout("INVOER_ONGELDIG", "Een gebruikscategorie hoort alleen bij type live.");
    let { staat: nieuw, id: caseId } = voegBelastinggevalToe(staat, name.trim(), type);
    if (cat !== undefined) nieuw = wijzigBelastinggeval(nieuw, caseId, { categorie: cat });
    return {
      uitkomst: { loadCase: nieuw.loadCases.find((lc) => lc.id === caseId), combinationsCount: nieuw.combinations.length, meldingen },
      document: metCombinatieStaat(document, nieuw),
    };
  },
});

const gevalWijzigen = documentCommando<{ id: number; name?: string; type?: LoadCase["type"]; categorie?: GebruiksCategorie | null }, unknown>({
  naam: "project.loadCase.update",
  beschrijving: "Naam, type of gebruikscategorie van een belastinggeval wijzigen; de standaardcombinaties volgen.",
  invoer: obj({
    id: id("Id van het belastinggeval."), name: tekst("Nieuwe naam.", { minLength: 1 }), type: gevalType,
    categorie: ofNull(categorie, "Gebruikscategorie; null = standaard (A)."),
  }, ["id"]),
  uitvoeren: ({ id: caseId, categorie: cat, ...rest }, document) => {
    vindGeval(document, caseId);
    const { staat, meldingen } = combinatieStaatVan(document);
    const patch: Partial<Omit<LoadCase, "id">> = {
      ...(rest.name !== undefined ? { name: rest.name.trim() } : {}),
      ...(rest.type !== undefined ? { type: rest.type } : {}),
      ...(cat !== undefined ? { categorie: cat ?? undefined } : {}),
    };
    const nieuw = metEigenGewichtRegel(metCombinatieStaat(document, wijzigBelastinggeval(staat, caseId, patch)), document.loadCases, meldingen);
    return { uitkomst: { loadCase: nieuw.loadCases.find((lc) => lc.id === caseId), selfWeightEnabled: nieuw.selfWeightEnabled, meldingen }, document: nieuw };
  },
});

const gevalVerwijderen = documentCommando<{ id: number }, unknown>({
  naam: "project.loadCase.delete",
  beschrijving: "Een belastinggeval verwijderen, met al zijn 2D- en 3D-lasten en belastingvlakken; zijn factoren verdwijnen uit elke combinatie. Het laatste geval kan niet weg.",
  invoer: obj({ id: id("Id van het belastinggeval.") }, ["id"]),
  uitvoeren: ({ id: caseId }, document) => {
    vindGeval(document, caseId);
    const { staat, meldingen } = combinatieStaatVan(document);
    const na = verwijderBelastinggeval(staat, caseId);
    if (na === staat) throw new ApiFout("GEWEIGERD", "Het laatste belastinggeval kan niet weg.");
    const lasten2d = document.loads.filter((load) => load.caseId !== caseId);
    const zonder3d = zonder3DLastenVanGeval(model3dVan(document), caseId);
    let nieuw: ApiDocument = {
      ...metCombinatieStaat(document, na),
      loads: lasten2d,
      ...(document.model3d ? { model3d: zonder3d.model } : {}),
      activeLoadCaseId: document.activeLoadCaseId === caseId ? na.loadCases[0].id : document.activeLoadCaseId,
    };
    nieuw = metEigenGewichtRegel(nieuw, document.loadCases, meldingen);
    return {
      uitkomst: {
        deletedLoadCaseId: caseId, removedLoads2d: document.loads.length - lasten2d.length,
        removedLoads3d: document.model3d ? zonder3d.aantal : 0, activeLoadCaseId: nieuw.activeLoadCaseId, meldingen,
      },
      document: nieuw,
    };
  },
});

const combinatieToevoegen = documentCommando<{ name: string; type: "uls" | "sls"; factors: { caseId: number; factor: number }[]; formula?: string }, unknown>({
  naam: "project.combination.add",
  beschrijving: "Een eigen belastingcombinatie toevoegen (UGT of BGT) met een factor per geval. De app past een eigen combinatie niet meer aan.",
  invoer: obj({
    name: tekst("Naam.", { minLength: 1 }), type: keuze(["uls", "sls"], "uls = UGT, sls = BGT."), factors: factoren,
    formula: tekst("Formule voor weergave; ontbreekt = uit de factoren."),
  }, ["name", "type", "factors"]),
  uitvoeren: ({ name, type, factors, formula }, document) => {
    const { staat, meldingen } = combinatieStaatVan(document);
    const map = factorenNaarMap(document, factors);
    const nieuw = voegCombinatieToe(staat, { name: name.trim(), type, formula: formula ?? formuleVoor(document, map), factors: map });
    const combinatie = nieuw.combinations[nieuw.combinations.length - 1];
    return { uitkomst: { combination: combinatieUit(combinatie), meldingen }, document: metCombinatieStaat(document, nieuw) };
  },
});

const combinatieWijzigen = documentCommando<{ id: number; name?: string; type?: "uls" | "sls"; factors?: { caseId: number; factor: number }[]; formula?: string }, unknown>({
  naam: "project.combination.update",
  beschrijving: "Een combinatie wijzigen. Daarmee wordt het een eigen combinatie: de app werkt haar niet meer bij als de gevallen veranderen.",
  invoer: obj({
    id: id("Id van de combinatie."), name: tekst("Naam.", { minLength: 1 }), type: keuze(["uls", "sls"]),
    factors: factoren, formula: tekst("Formule voor weergave."),
  }, ["id"]),
  uitvoeren: ({ id: combinationId, factors, ...rest }, document) => {
    const { staat, meldingen } = combinatieStaatVan(document);
    if (!staat.combinations.some((c) => c.id === combinationId)) throw nietGevonden("Combinatie", combinationId);
    const map = factors ? factorenNaarMap(document, factors) : undefined;
    const patch: Partial<Omit<LoadCombination, "id">> = {
      ...rest, ...(map ? { factors: map, formula: rest.formula ?? formuleVoor(document, map) } : {}),
    };
    const nieuw = wijzigCombinatie(staat, combinationId, patch);
    return {
      uitkomst: { combination: combinatieUit(nieuw.combinations.find((c) => c.id === combinationId)!), meldingen },
      document: metCombinatieStaat(document, nieuw),
    };
  },
});

const combinatieVerwijderen = documentCommando<{ id: number }, unknown>({
  naam: "project.combination.delete",
  beschrijving: "Een combinatie verwijderen. Een standaardcombinatie komt terug bij Standaard herstellen.",
  invoer: obj({ id: id("Id van de combinatie.") }, ["id"]),
  uitvoeren: ({ id: combinationId }, document) => {
    const { staat, meldingen } = combinatieStaatVan(document);
    if (!staat.combinations.some((c) => c.id === combinationId)) throw nietGevonden("Combinatie", combinationId);
    return { uitkomst: { deletedCombinationId: combinationId, meldingen }, document: metCombinatieStaat(document, verwijderCombinatie(staat, combinationId)) };
  },
});

const standaardHerstellen = documentCommando<Record<string, never>, unknown>({
  naam: "project.combinations.resetToStandard",
  beschrijving: "Alle combinaties vervangen door de standaardset volgens de norm (gevolgklasse en nationale bijlage van het project).",
  invoer: obj({}),
  uitvoeren: (_invoer, document) => {
    const { staat, meldingen } = combinatieStaatVan(document);
    const nieuw = vervangDoorStandaard(staat);
    return { uitkomst: { combinations: combinationsToFile(nieuw.combinations), meldingen }, document: metCombinatieStaat(document, nieuw) };
  },
});

/** De combinaties uit `ids`: elk id moet bestaan. */
function eisCombinaties(staat: CombinatieStaat, ids: readonly number[] | undefined): void {
  for (const combinationId of ids ?? []) {
    if (!staat.combinations.some((c) => c.id === combinationId)) throw nietGevonden("Combinatie", combinationId, "ids");
  }
}

const combinatieIds = lijst(id("Id van een combinatie."), "Welke combinaties; ontbreekt = alle eigen combinaties.", { minItems: 1 });

const eigenFactorenHouden = documentCommando<{ ids?: number[] }, unknown>({
  naam: "project.combinations.confirmOwnFactors",
  beschrijving:
    "Eigen factoren bewust houden (de knop \"Behoud eigen factoren\"): de huidige factoren van de genoemde eigen " +
    "combinaties — zonder ids alle eigen combinaties — worden vastgelegd als bewust gekozen, bijvoorbeeld K_FI × " +
    "NB tabel NB.4 (1,22 / 1,08). Een blijvend geval met zo'n factor geeft dan geen FOUT meer, en een eigen " +
    "combinatie met dezelfde gevallen telt als vervanger van de standaardcombinatie waarvan ze alleen in bevestigde " +
    "factoren afwijkt. De bevestiging geldt per factor en alleen voor precies die waarde: een gewijzigde factor " +
    "verliest haar. Standaardcombinaties, combinaties van de windgenerator en de standaardset van versie 0.3.11 en " +
    "ouder worden niet bevestigd (met ids: GEWEIGERD). De berekening verandert niet.",
  invoer: obj({ ids: combinatieIds }),
  uitvoeren: ({ ids }, document) => {
    const { staat, vervanging } = combinatieStaatVan(document);
    eisCombinaties(staat, ids);
    const uit = bevestigEigenFactoren(staat, ids);
    if (ids && uit.overgeslagen.length > 0) {
      throw new ApiFout(
        "GEWEIGERD",
        uit.overgeslagen.map((o) => `Combinatie ${o.id} ("${o.naam}") is ${o.reden}.`).join(" "),
      );
    }
    return {
      uitkomst: {
        confirmedCombinationIds: uit.bevestigd,
        skipped: uit.overgeslagen.map((o) => ({ id: o.id, name: o.naam, reason: o.reden })),
        combinations: combinationsToFile(uit.staat.combinations),
        meldingen: meldingenNa(uit.staat, vervanging),
      },
      document: metCombinatieStaat(document, uit.staat),
    };
  },
});

const eigenFactorenIntrekken = documentCommando<{ ids?: number[] }, unknown>({
  naam: "project.combinations.revokeOwnFactors",
  beschrijving:
    "De bevestiging van eigen factoren intrekken (zonder ids: van alle combinaties). Daarna meldt de app een " +
    "blijvend geval met een factor buiten NB tabel NB.4/NB.5 weer als FOUT. De berekening verandert niet.",
  invoer: obj({ ids: combinatieIds }),
  uitvoeren: ({ ids }, document) => {
    const { staat, vervanging } = combinatieStaatVan(document);
    eisCombinaties(staat, ids);
    const uit = trekBevestigingIn(staat, ids);
    return {
      uitkomst: {
        revokedCombinationIds: uit.ingetrokken,
        combinations: combinationsToFile(uit.staat.combinations),
        meldingen: meldingenNa(uit.staat, vervanging),
      },
      document: metCombinatieStaat(document, uit.staat),
    };
  },
});

// ── Scheefstand (EN 1993-1-1 5.3.2) ───────────────────────────────────────

/** De scheefstandinstellingen van het document, met de standaarden van de app bij ontbrekende velden. */
function scheefstandVan(document: ApiDocument) {
  return {
    enabled: document.scheefstandEnabled === true,
    source: (SCHEEFSTAND_BRONNEN as readonly unknown[]).includes(document.scheefstandBron)
      ? document.scheefstandBron as ScheefstandBron : "vast",
    denominator: typeof document.scheefstandNoemer === "number" && document.scheefstandNoemer > 0
      ? document.scheefstandNoemer : 200,
    heightM: document.scheefstandHoogteM ?? null,
    members: document.scheefstandAantalElementen ?? null,
    membersX: document.scheefstandAantalX ?? null,
    membersY: document.scheefstandAantalY ?? null,
    torsion: document.scheefstandTorsie === true,
    ownColumnSway: document.scheefstandEigenKolom === true,
  };
}

type ScheefstandInvoer = {
  enabled?: boolean; source?: ScheefstandBron; denominator?: number; heightM?: number | null;
  members?: number | null; membersX?: number | null; membersY?: number | null; torsion?: boolean;
  ownColumnSway?: boolean;
};

const scheefstandLezen = documentCommando<Record<string, never>, unknown>({
  naam: "project.sway.get",
  beschrijving: "De instellingen van de initiële scheefstand (EN 1993-1-1 5.3.2): schakelaar voor de resultaten, bron van φ, vaste noemer, handmatige h en m, in 3D m per richting (membersX, membersY) en de torsievarianten van 5.3.2(10). De UGT-toets rekent altijd met scheefstand (issue #199).",
  invoer: obj({}),
  uitvoeren: (_invoer, document) => ({ uitkomst: scheefstandVan(document) }),
});

const scheefstandZetten = documentCommando<ScheefstandInvoer, unknown>({
  naam: "project.sway.set",
  beschrijving: "De initiële scheefstand (EN 1993-1-1 5.3.2) instellen; alleen de opgegeven velden veranderen. " +
    "membersX/membersY (alleen 3D, issue #212) overschrijven m per richting (5.3.2(3): een kolom met minder dan 50 % " +
    "van de gemiddelde verticale kolomkracht mag eruit); null = de gedeelde m of de afleiding uit de kolomrijen. " +
    "torsion (alleen 3D) zet de torsievarianten van 5.3.2(10) (figuur 5.5) aan: per richting met twee of meer kolomrijen " +
    "twee varianten extra, wat het aantal P-Δ-berekeningen van de UGT-toets verdubbelt; niet bij vlaklasten op platen.",
  invoer: obj({
    enabled: jaNee("Scheefstand in de RESULTATEN (de UGT-toets rekent er altijd mee)."),
    source: keuze([...SCHEEFSTAND_BRONNEN], "Bron van φ: vast (1/denominator) of een norm."),
    denominator: getal("Vaste noemer x in φ = 1/x.", { exclusiveMinimum: 0 }),
    heightM: ofNull(getal("Handmatige h in m.", { exclusiveMinimum: 0 }), "null = afleiden."),
    members: ofNull(geheel("Handmatige m, in X en in Y.", { minimum: 1 }), "null = afleiden."),
    membersX: ofNull(geheel("Alleen 3D: handmatige m_X.", { minimum: 1 }), "null = members of afleiden."),
    membersY: ofNull(geheel("Alleen 3D: handmatige m_Y.", { minimum: 1 }), "null = members of afleiden."),
    torsion: jaNee("Alleen 3D: de torsievarianten van EN 1993-1-1 5.3.2(10)."),
    ownColumnSway: jaNee("Alleen 3D (issue #199, fase 3): een kolom met een vrije kop krijgt in de UGT-toets max(φ_model, φ_eigen) op haar lasten (h = haar hoogte, m = 1); daarmee geldt voor een stalen losse kolom de systeemlengte."),
  }),
  uitvoeren: (invoer, document) => {
    const nieuw: ApiDocument = {
      ...document,
      ...(invoer.enabled !== undefined ? { scheefstandEnabled: invoer.enabled } : {}),
      ...(invoer.source !== undefined ? { scheefstandBron: invoer.source } : {}),
      ...(invoer.denominator !== undefined ? { scheefstandNoemer: invoer.denominator } : {}),
      ...(invoer.heightM !== undefined ? { scheefstandHoogteM: invoer.heightM } : {}),
      ...(invoer.members !== undefined ? { scheefstandAantalElementen: invoer.members } : {}),
      ...(invoer.membersX !== undefined ? { scheefstandAantalX: invoer.membersX } : {}),
      ...(invoer.membersY !== undefined ? { scheefstandAantalY: invoer.membersY } : {}),
      ...(invoer.torsion !== undefined ? { scheefstandTorsie: invoer.torsion } : {}),
      ...(invoer.ownColumnSway !== undefined ? { scheefstandEigenKolom: invoer.ownColumnSway } : {}),
    };
    return { uitkomst: scheefstandVan(nieuw), document: nieuw };
  },
});

export const PROJECT_COMMANDOS = [
  projectLezen, projectNieuw, gevalToevoegen, gevalWijzigen, gevalVerwijderen,
  combinatieToevoegen, combinatieWijzigen, combinatieVerwijderen, standaardHerstellen,
  eigenFactorenHouden, eigenFactorenIntrekken, scheefstandLezen, scheefstandZetten,
];

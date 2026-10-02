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
import { getal, id, jaNee, keuze, lijst, obj, ofNull, tekst } from "../schemaBouw";
import { combinationsFromFile, combinationsToFile } from "../../io/projectFile";
import {
  gevolgklasseBijOpenen, openCombinatieStaat, vervangDoorStandaard, verwijderBelastinggeval, verwijderCombinatie,
  voegBelastinggevalToe, voegCombinatieToe, wijzigBelastinggeval, wijzigCombinatie, type CombinatieStaat,
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
function combinatieStaatVan(document: ApiDocument): { staat: CombinatieStaat; meldingen: string[] } {
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
  });
  return {
    staat,
    meldingen: [vervanging?.samenvatting, afwijking?.samenvatting].filter((x): x is string => typeof x === "string" && x !== ""),
  };
}

function metCombinatieStaat(document: ApiDocument, staat: CombinatieStaat): ApiDocument {
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

export const PROJECT_COMMANDOS = [
  projectLezen, projectNieuw, gevalToevoegen, gevalWijzigen, gevalVerwijderen,
  combinatieToevoegen, combinatieWijzigen, combinatieVerwijderen, standaardHerstellen,
];

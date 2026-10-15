/**
 * De API-commando's (src/api/) in de draaiende app: het bedieningskanaal
 * (`api_catalogus`, `api_uitvoeren`) komt hier uit.
 *
 * Een documentcommando rekent op het document zoals Opslaan het zou schrijven
 * (`document()`); daarna zet `pasToe` alleen terug wat veranderde:
 *  - het 3D-model, met de levels als die veranderden, als één stap ongedaan
 *    maken (`bewerk3D`); de dimensie via haar eigen setter; het stramien
 *    zonder 3D-model via `zetStramien`;
 *  - gevallen, combinaties, tellers, 2D-lasten, actief geval en eigen gewicht
 *    via `zetGevallen` (dezelfde `pasCombiStaatToe` als de dialogen);
 *  - een ander veld (het 2D-model, instellingen: latere fasen) kan de app nog
 *    niet als één stap toepassen: dan weigert de adapter vóór er iets
 *    verandert. Opnieuw laden zou de historie wissen en het werk als
 *    opgeslagen tonen.
 * Een nieuw project (`nieuwProject` in de uitkomst, project.new) laadt de app
 * zoals Bestand → Nieuw. App-commando's (ongedaan maken, opslaan, openen)
 * krijgen hier hun echte uitvoering. Nieuw en openen vervangen het project;
 * met niet-opgeslagen wijzigingen weigeren ze, tenzij `discardChanges` true
 * is: de app stelt hier geen vraag, dus de aanroeper moet het weten.
 *
 * Geen React: de app levert de acties; zo blijft dit testbaar.
 */
import { ApiFout, maakRegister, type ApiCommando, type ApiRegister } from "../api/register";
import { documentNaarTekst, type ApiDocument } from "../api/projectDocument";
import { standaardCommandos } from "../api/standaardRegister";
import { combinationsFromFile } from "../io/projectFile";
import type { OpenFem3DModel } from "../components/openFem3d/openFem3dModel";
import type { OpenFem3DExternStap } from "../components/openFem3d/openFem3dHistory";
import type { OpenFem3DSelection } from "../components/openFem3d/openFem3dSelection";
import type { OpenFem3DExplode, OpenFem3DExplodeMode } from "../components/openFem3d/openFem3dExplode";
import type { Load, LoadCase, StructuralGrid } from "../components/fem/femTypes";
import type { LoadCombination } from "../components/fem/solver/combinations";
import type { ExtensieKaart } from "../extensies/extensieStore";
import type { ExtensieManifest, ImportMelding } from "../extensies/manifest";

export interface ApiAppActies {
  /** Het project zoals Opslaan het zou schrijven. */
  document(): ApiDocument;
  /**
   * Het 3D-model vervangen als één stap ongedaan maken; met `stramien` ook de
   * levels, in dezelfde stap (zoals het stramienvenster). Met `extern` hoort
   * een wijziging buiten het model bij die stap (de gevallen, #91): undo en
   * redo voeren dan ook `terug` of `vooruit` uit.
   */
  bewerk3D(model: OpenFem3DModel, stramien?: StructuralGrid, extern?: OpenFem3DExternStap): void;
  zetModelDimensie(dimensie: "2d" | "3d"): void;
  /** Het stramien zetten in een project zonder 3D-model (zoals het stramienvenster in 2D). */
  zetStramien(stramien: StructuralGrid): void;
  zetGevallen(p: {
    loadCases: LoadCase[]; combinations: LoadCombination[];
    idTellers?: { belastinggeval: number; combinatie: number };
    loads: Load[]; activeLoadCaseId: number; selfWeightEnabled: boolean;
  }): void;
  /**
   * Een nieuw project laden, zoals Bestand → Nieuw: langs dezelfde weg als
   * Openen, maar zonder bestand (Opslaan vraagt daarna om een pad).
   */
  nieuwProject(tekst: string): Promise<void>;
  /**
   * Hetzelfde als Ctrl+Z en Ctrl+Y. Geeft `false` als er geen stap was om
   * ongedaan te maken of opnieuw te doen (issue #244, punt 001): dan
   * gebeurde er niets, en dat hoort het antwoord te zeggen.
   */
  ongedaanMaken(): boolean;
  opnieuw(): boolean;
  /** Opslaan (zonder pad: naar het huidige bestand, of de dialoog); geeft het pad. */
  opslaan(pad?: string): Promise<string>;
  /** Een projectbestand openen zoals Openen (zonder vraag); geeft het pad. */
  openen(pad: string): Promise<string>;
  importeren(pad: string, importerId?: string): Promise<{ meldingen: ImportMelding[]; extensie: ExtensieManifest }>;
  extensies(): Promise<ExtensieKaart[]>;
  /** Of het project wijzigingen heeft die nog niet zijn opgeslagen. */
  heeftNietOpgeslagenWerk(): boolean;
  /**
   * De 3D-selectie zetten, zoals Toepassen in het venster Selectiefilter
   * (issue #94): `model3d.selection.filter` met `select: true`. Verplicht,
   * zodat tsc bewaakt dat App.tsx hem levert. De sidecar bouwt geen
   * ApiAppActies; daar heeft het commando geen app en zet het niets.
   */
  zetSelectie3D(selectie: OpenFem3DSelection): void;
  /** De explode in de zichtbaarheid (alleen weergave): per level of per elementsoort, afstand in m per stap. */
  zetExplode3D(explode: OpenFem3DExplode): void;
}

export type ApiAntwoord =
  | { ok: true; output: unknown }
  | { ok: false; error: { code: string; melding: string; detail: unknown } };

const FIJN_TOEGEPAST = new Set([
  "model3d", "modelDimension", "structuralGrid",
  "loadCases", "combinations", "idTellers", "loads", "activeLoadCaseId", "selfWeightEnabled",
]);
const GEVALVELDEN = ["loadCases", "combinations", "idTellers", "loads", "activeLoadCaseId", "selfWeightEnabled"];

/** Zet terug wat het commando aan het document veranderde. */
export async function pasToe(acties: ApiAppActies, oud: ApiDocument, nieuw: ApiDocument): Promise<void> {
  const sleutels = new Set([...Object.keys(oud), ...Object.keys(nieuw)]) as Set<keyof ApiDocument>;
  const gewijzigd = [...sleutels].filter((k) => oud[k] !== nieuw[k]);
  if (gewijzigd.length === 0) return;
  const anders = gewijzigd.filter((k) => !FIJN_TOEGEPAST.has(k));
  if (anders.length > 0) {
    throw new ApiFout(
      "INTERN",
      `Dit commando wijzigt ${anders.join(", ")}; dat kan de app nog niet als één stap toepassen. `
        + "Er is niets veranderd. Op een bestand (met `project`) werkt het wel.",
      { velden: anders },
    );
  }
  const gevallenAnders = gewijzigd.some((k) => GEVALVELDEN.includes(k));
  const nieuweGevallen = gevallenAnders ? gevallenVan(nieuw) : null;
  if (gewijzigd.includes("modelDimension") && nieuw.modelDimension) acties.zetModelDimensie(nieuw.modelDimension);
  const stramienAnders = gewijzigd.includes("structuralGrid");
  if ((gewijzigd.includes("model3d") || stramienAnders) && nieuw.model3d) {
    // Veranderen ook de gevallen (bijv. een geval verwijderen met zijn
    // 3D-lasten), dan is dat één stap: undo zet ook de gevallen terug (#91).
    const oudeGevallen = nieuweGevallen ? gevallenVan(oud) : null;
    const extern = oudeGevallen && nieuweGevallen
      ? { terug: () => acties.zetGevallen(oudeGevallen), vooruit: () => acties.zetGevallen(nieuweGevallen) }
      : undefined;
    acties.bewerk3D(nieuw.model3d, stramienAnders ? nieuw.structuralGrid : undefined, extern);
  } else if (stramienAnders && nieuw.structuralGrid) {
    acties.zetStramien(nieuw.structuralGrid);
  }
  if (nieuweGevallen) acties.zetGevallen(nieuweGevallen);
}

/** De gevalvelden van een document, zoals `zetGevallen` ze wil. */
function gevallenVan(document: ApiDocument): Parameters<ApiAppActies["zetGevallen"]>[0] {
  const combinaties = combinationsFromFile(document.combinations);
  if (!combinaties) throw new ApiFout("INTERN", "De combinaties van het document zijn niet te lezen.");
  return {
    loadCases: document.loadCases, combinations: combinaties, idTellers: document.idTellers,
    loads: document.loads, activeLoadCaseId: document.activeLoadCaseId, selfWeightEnabled: document.selfWeightEnabled,
  };
}

/** Weigert als het project niet-opgeslagen wijzigingen heeft en de aanroeper die niet wil weggooien. */
function bewaakNietOpgeslagen(acties: ApiAppActies, invoer: unknown): void {
  const weggooien = (invoer as { discardChanges?: unknown } | undefined)?.discardChanges === true;
  if (!weggooien && acties.heeftNietOpgeslagenWerk()) {
    throw new ApiFout(
      "GEWEIGERD",
      "Het project in de app heeft niet-opgeslagen wijzigingen. Sla eerst op (app.project.save) of geef discardChanges: true; dan gaan ze verloren.",
    );
  }
}

/** Het register van de app: de app-commando's met hun echte uitvoering. */
export function appRegister(acties: ApiAppActies): ApiRegister {
  const echt: Record<string, ApiCommando["uitvoeren"]> = {
    "app.view3d.explode": (invoer: { mode: OpenFem3DExplodeMode; amountMm: number }) => {
      acties.zetExplode3D({ mode: invoer.mode, amountM: invoer.amountMm / 1000 });
      return { uitkomst: { mode: invoer.mode, amountMm: invoer.amountMm } };
    },
    // `done: false` met de reden als er niets te doen was; tot oktober 2026
    // gaf app.redo zonder herhaalbare actie `done: true` (issue #244, punt 001).
    "app.undo": () => (acties.ongedaanMaken()
      ? { uitkomst: { done: true } }
      : { uitkomst: { done: false, reason: "Er is geen wijziging om ongedaan te maken; er is niets veranderd." } }),
    "app.redo": () => (acties.opnieuw()
      ? { uitkomst: { done: true } }
      : { uitkomst: { done: false, reason: "Er is geen ongedaan gemaakte wijziging om opnieuw te doen; er is niets veranderd." } }),
    "app.project.save": async (invoer: { path?: string }) => ({ uitkomst: { path: await acties.opslaan(invoer.path) } }),
    "app.project.open": async (invoer: { path: string; discardChanges?: boolean }) => {
      bewaakNietOpgeslagen(acties, invoer);
      return { uitkomst: { path: await acties.openen(invoer.path) } };
    },
    "app.project.import": async (invoer: { path: string; importer?: string; discardChanges?: boolean }) => {
      bewaakNietOpgeslagen(acties, invoer);
      const { meldingen, extensie } = await acties.importeren(invoer.path, invoer.importer);
      return { uitkomst: { path: invoer.path, project: "nieuw", messages: meldingen,
        extension: { id: extensie.id, name: extensie.name, version: extensie.version } } };
    },
    "extensions.list": async () => ({ uitkomst: { extensions: (await acties.extensies()).map((kaart) => ({
      id: kaart.manifest?.id ?? null,
      name: kaart.manifest?.name ?? null,
      version: kaart.manifest?.version ?? null,
      enabled: kaart.ingeschakeld,
      source: kaart.bron,
      folder: kaart.map,
      importers: kaart.manifest?.importers ?? [],
      ...(kaart.fout ? { error: kaart.fout } : {}),
    })) } }),
  };
  return maakRegister(standaardCommandos().map((commando) =>
    commando.soort === "app" && echt[commando.naam] ? { ...commando, uitvoeren: echt[commando.naam] } : commando));
}

/** Eén commando in de app: uitvoeren, het document terugzetten, en een antwoord dat altijd heel aankomt. */
export async function voerApiUitInApp(acties: ApiAppActies, naam: string, invoer: unknown): Promise<ApiAntwoord> {
  try {
    const register = appRegister(acties);
    const oud = acties.document();
    const resultaat = await register.voerUit(naam, invoer, { document: oud, app: acties });
    if (resultaat.document && resultaat.nieuwProject) {
      bewaakNietOpgeslagen(acties, invoer);
      await acties.nieuwProject(documentNaarTekst(resultaat.document));
    }
    else if (resultaat.document && resultaat.document !== oud) await pasToe(acties, oud, resultaat.document);
    return { ok: true, output: resultaat.uitkomst };
  } catch (fout) {
    const apiFout = fout instanceof ApiFout ? fout : new ApiFout("INTERN", fout instanceof Error ? fout.message : String(fout));
    return { ok: false, error: { code: apiFout.code, melding: apiFout.message, detail: apiFout.detail ?? null } };
  }
}

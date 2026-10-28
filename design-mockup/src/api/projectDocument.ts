/**
 * Het projectdocument waarop de API-commando's werken: de vorm van een
 * `.ifcfem`-bestand, zonder de metavelden (formaat-id, versie, tijdstip).
 *
 * Een documentcommando krijgt een document en geeft een NIEUW document terug;
 * het oude blijft ongewijzigd. Zo kan de app het als één stap ongedaan maken
 * toepassen, en kan de sidecar het zonder app op een bestand uitvoeren.
 * (De)serialiseren loopt via `io/projectFile.ts`, precies als Opslaan en
 * Openen in de app.
 *
 * Zuiver: geen React, geen DOM, geen Tauri. Gaat mee in de sidecarbundel.
 */
import { deserializeProject, serializeProject, type ProjectFile } from "../io/projectFile";
import { EMPTY_OPEN_FEM_3D, type OpenFem3DModel } from "../components/openFem3d/openFem3dModel";
import {
  EIGEN_GEWICHT_STANDAARD_AAN, STANDAARD_ACTIEF_GEVAL_ID, standaardBelastinggevallen,
} from "../lib/eigenGewicht";
import {
  eigenDoorsnedenStore, exporteer as exporteerEigenDoorsneden, importeer as importeerEigenDoorsneden,
} from "../lib/profieleditor/eigenDoorsnedenStore";
import type { EigenDoorsnede } from "../lib/profieleditor/types";

export type ApiDocument = Omit<ProjectFile, "format" | "version" | "savedAt">;

/** Het document uit de tekst van een projectbestand; gooit bij onleesbare tekst. */
export function documentUitTekst(tekst: string): ApiDocument {
  const { format: _format, version: _versie, savedAt: _opgeslagen, ...document } = deserializeProject(tekst);
  return document;
}

/** De tekst van een projectbestand, met het huidige formaat-id. */
export function documentNaarTekst(document: ApiDocument): string {
  return serializeProject(document);
}

/**
 * Een nieuw, leeg 3D-project, met dezelfde gevallen en instellingen als
 * Bestand → Nieuw in de app (`handleNewProject`).
 */
export function leegDocument(): ApiDocument {
  return {
    modelDimension: "3d",
    nodes: [], beams: [], supports: [], plates: [], loads: [],
    loadCases: standaardBelastinggevallen(),
    activeLoadCaseId: STANDAARD_ACTIEF_GEVAL_ID,
    selfWeightEnabled: EIGEN_GEWICHT_STANDAARD_AAN,
    nonlinearEnabled: false,
    analysetype: "eersteOrde",
    model3d: { ...EMPTY_OPEN_FEM_3D },
  };
}

/** Het 3D-model van het document; een leeg model als het document er geen heeft. */
export function model3dVan(document: ApiDocument): OpenFem3DModel {
  return document.model3d ?? { ...EMPTY_OPEN_FEM_3D };
}

/** Een nieuw document met dit 3D-model; het project wordt daarmee een 3D-project. */
export function metModel3d(document: ApiDocument, model: OpenFem3DModel): ApiDocument {
  return { ...document, model3d: model, modelDimension: "3d" };
}

/**
 * De eigen doorsneden van het document in de winkel zetten, zoals Openen in de
 * app doet (`importeer`: het project wint bij een gelijke naam). Een staaf met
 * `EIGEN:<naam>` — de gelaste tussendoorsnede van een gesplitste verlopende
 * staaf (#73) — is anders zonder app niet te rekenen of te toetsen. Doet niets
 * als de winkel ze al precies zo heeft.
 */
export function eigenDoorsnedenNaarWinkel(document: ApiDocument): void {
  const binnen = document.eigenDoorsneden ?? [];
  if (binnen.length === 0) return;
  const winkel = eigenDoorsnedenStore.getState().items;
  const nieuw = binnen.some((d) => {
    const bestaand = winkel.find((x) => x.naam === d.naam);
    return !bestaand || JSON.stringify(bestaand) !== JSON.stringify(d);
  });
  if (nieuw) importeerEigenDoorsneden(binnen);
}

/** Wat `gebruikteEigenDoorsneden` van een project leest: de staven en de modeldimensie. */
export interface ProjectStaven {
  beams?: Iterable<{ profile?: string; profileEnd?: string }>;
  modelDimension?: "2d" | "3d";
  model3d?: { beams: readonly { profileName?: string; profileNameEnd?: string }[] };
}

/**
 * De eigen doorsneden waar een project naar verwijst, zoals ze in het
 * projectbestand horen: die van de 2D-staven, en in een 3D-project ook die
 * van de 3D-staven, telkens begin- én eindprofiel. Een 3D-project volgens
 * dezelfde regel als `serializeProject`: `modelDimension`, en zonder dat veld
 * de aanwezigheid van `model3d` (een 2D-project schrijft geen `model3d`).
 *
 * Eén regel voor Opslaan in de app (`App.buildProjectSnapshot`) en de
 * API-commando's (`metGebruikteEigenDoorsneden`). Het splitsen van een
 * verlopende stalen 3D-staaf, en de wizard Stalen hal met een verlopende
 * spantligger (#73), laten een gelaste tussendoorsnede achter die een staaf
 * alleen als eindprofiel kan dragen; ontbreekt die in het bestand, dan is het
 * project op een andere machine niet meer te rekenen.
 */
export function gebruikteEigenDoorsneden(project: ProjectStaven): EigenDoorsnede[] {
  const drieD = (project.modelDimension ?? (project.model3d !== undefined ? "3d" : "2d")) === "3d";
  return exporteerEigenDoorsneden([
    ...(project.beams ?? []),
    ...(drieD ? (project.model3d?.beams ?? []).map((beam) => ({ profile: beam.profileName, profileEnd: beam.profileNameEnd })) : []),
  ]);
}

/**
 * Het document met de eigen doorsneden waar zijn staven (2D en 3D, begin- en
 * eindprofiel) naar verwijzen en die het nog niet draagt — zoals Opslaan in de
 * app ze meeneemt (`gebruikteEigenDoorsneden`). Een commando dat een
 * tussendoorsnede maakt (splitsen van een verlopende stalen staaf), laat het
 * document zo rekenbaar achter. Zonder zulke verwijzing blijft het document
 * ongewijzigd.
 */
export function metGebruikteEigenDoorsneden(document: ApiDocument): ApiDocument {
  const bestaand = document.eigenDoorsneden ?? [];
  const erbij = gebruikteEigenDoorsneden(document).filter((d) => !bestaand.some((b) => b.naam === d.naam));
  return erbij.length > 0 ? { ...document, eigenDoorsneden: [...bestaand, ...erbij] } : document;
}

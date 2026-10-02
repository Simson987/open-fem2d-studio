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

/**
 * Alle API-commando's samen: de catalogus die het bedieningskanaal en de
 * MCP-server tonen. Zonder React, zodat de sidecar hetzelfde register heeft
 * als de app.
 *
 * App-commando's (`soort: "app"`) staan er ook in, zodat de catalogus overal
 * gelijk is. Buiten de app geven ze ALLEEN_IN_APP; de app-adapter
 * (`bediening/apiAdapter.ts`) vervangt hun uitvoering door de echte.
 */
import { ApiFout, maakRegister, type ApiCommando, type ApiRegister } from "./register";
import { jaNee, obj, tekst } from "./schemaBouw";
import { MODEL3D_GEOMETRIE_COMMANDOS } from "./commands/model3dGeometrie";
import { MODEL3D_VOORWAARDEN_COMMANDOS } from "./commands/model3dVoorwaarden";
import { MODEL3D_BEWERKEN_COMMANDOS } from "./commands/model3dBewerken";
import { PROJECT_COMMANDOS } from "./commands/project";
import { STRAMIEN_COMMANDOS } from "./commands/stramien";

function alleenInApp(naam: string, beschrijving: string, invoer = obj({})): ApiCommando {
  return {
    naam, beschrijving, invoer, soort: "app",
    uitvoeren: () => {
      throw new ApiFout("ALLEEN_IN_APP", `${naam} werkt alleen in de draaiende app (start haar met OPENAEC_GUI_CONTROL=1).`);
    },
  };
}

export const APP_COMMANDOS: readonly ApiCommando[] = [
  alleenInApp("app.undo", "De laatste modelwijziging ongedaan maken (zoals Ctrl+Z)."),
  alleenInApp("app.redo", "De ongedaan gemaakte wijziging opnieuw doen (zoals Ctrl+Y)."),
  alleenInApp("app.project.save",
    "Het project opslaan (zoals Opslaan). Met path: opslaan als dat bestand, zonder dialoog.",
    obj({ path: tekst("Absoluut pad naar een .ifcfem-bestand.", { minLength: 1 }) })),
  alleenInApp("app.project.open",
    "Een projectbestand openen in de app (zoals Openen). Heeft het huidige project niet-opgeslagen wijzigingen, dan weigert de app, tenzij discardChanges true is.",
    obj({
      path: tekst("Absoluut pad naar een .ifcfem- of .ifcfem2d-bestand.", { minLength: 1 }),
      discardChanges: jaNee("Ook openen als het huidige project niet-opgeslagen wijzigingen heeft; die gaan verloren."),
    }, ["path"])),
];

/** Alle commando's: documentcommando's (ook zonder app) en app-commando's. */
export function standaardCommandos(): ApiCommando[] {
  return [
    ...PROJECT_COMMANDOS,
    ...STRAMIEN_COMMANDOS,
    ...MODEL3D_GEOMETRIE_COMMANDOS,
    ...MODEL3D_VOORWAARDEN_COMMANDOS,
    ...MODEL3D_BEWERKEN_COMMANDOS,
    ...APP_COMMANDOS,
  ];
}

export function standaardRegister(): ApiRegister {
  return maakRegister(standaardCommandos());
}

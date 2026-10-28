/**
 * Het contract van een extensie (docs/extensies.md): het manifest
 * `extension.json` en wat `importFile` teruggeeft. Gedeeld door de app (die de
 * extensie in een Web Worker draait) en de sidecar (die haar in Node draait).
 *
 * Een extensie is een map met een manifest en één script dat
 * `globalThis.openFemExtension = { importFile }` zet. `importFile` krijgt de
 * bytes van een bestand en geeft een gewoon projectdocument terug, plus
 * meldingen voor het importverslag. Het document gaat altijd door dezelfde
 * strikte lezer als Bestand → Openen.
 *
 * Zuiver: geen React, geen DOM, geen Node. Gaat mee in de sidecarbundel.
 */
import { deserializeProject, serializeProject, type ProjectFile } from "../io/projectFile";

export interface ExtensieImporteur {
  id: string;
  label: string;
  /** Kleine letters, zonder punt, bijv. "demofem". */
  fileExtensions: string[];
  dimension: "2d" | "3d";
}

export interface ExtensieManifest {
  id: string;
  name: string;
  version: string;
  apiVersion: 1;
  main: string;
  description?: string;
  author?: string;
  category?: string;
  importers: ExtensieImporteur[];
}

export type ManifestKeuring = { ok: true; manifest: ExtensieManifest } | { ok: false; fouten: string[] };

const MANIFEST_VELDEN = new Set(["id", "name", "version", "apiVersion", "main", "description", "author", "category", "importers"]);
const IMPORTEUR_VELDEN = new Set(["id", "label", "fileExtensions", "dimension"]);
const ID = /^[a-z0-9]+(\.[a-z0-9-]+)+$/;
const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const BESTANDSTYPE = /^[a-z0-9]+$/;
const IMPORTEUR_ID = /^[a-z0-9][a-z0-9-]*$/;

const isObject = (waarde: unknown): waarde is Record<string, unknown> =>
  typeof waarde === "object" && waarde !== null && !Array.isArray(waarde);
const isTekst = (waarde: unknown): waarde is string => typeof waarde === "string" && waarde.trim().length > 0;

/** Keur `extension.json`: streng, met elke fout in gewone taal. */
export function keurManifest(tekst: string): ManifestKeuring {
  let ruw: unknown;
  try {
    ruw = JSON.parse(tekst);
  } catch (fout) {
    return { ok: false, fouten: [`extension.json is geen geldige JSON: ${fout instanceof Error ? fout.message : String(fout)}`] };
  }
  if (!isObject(ruw)) return { ok: false, fouten: ["extension.json moet een object zijn."] };
  const fouten: string[] = [];
  for (const veld of Object.keys(ruw)) {
    if (!MANIFEST_VELDEN.has(veld)) fouten.push(`Onbekend veld "${veld}" in extension.json.`);
  }
  if (!isTekst(ruw.id) || !ID.test(ruw.id)) fouten.push(`"id" moet een omgekeerde domeinnaam zijn, bijv. "nl.voorbeeld.importeur".`);
  if (!isTekst(ruw.name)) fouten.push(`"name" ontbreekt.`);
  if (!isTekst(ruw.version) || !SEMVER.test(ruw.version)) fouten.push(`"version" moet een versie zijn zoals "1.0.0".`);
  if (ruw.apiVersion !== 1) fouten.push(`"apiVersion" moet 1 zijn; deze app kent alleen versie 1 van het contract.`);
  if (!isTekst(ruw.main)) fouten.push(`"main" (het scriptbestand) ontbreekt.`);
  else if (/^[\\/]|^[a-zA-Z]:|(^|[\\/])\.\.([\\/]|$)/.test(ruw.main)) fouten.push(`"main" moet een pad binnen de extensiemap zijn, zonder "..".`);
  for (const veld of ["description", "author", "category"] as const) {
    if (ruw[veld] !== undefined && typeof ruw[veld] !== "string") fouten.push(`"${veld}" moet tekst zijn.`);
  }
  if (!Array.isArray(ruw.importers) || ruw.importers.length === 0) {
    fouten.push(`"importers" moet een lijst met minstens één importeur zijn.`);
  } else {
    const ids = new Set<string>();
    ruw.importers.forEach((importeur, index) => {
      const waar = `importers[${index}]`;
      if (!isObject(importeur)) { fouten.push(`${waar} moet een object zijn.`); return; }
      for (const veld of Object.keys(importeur)) {
        if (!IMPORTEUR_VELDEN.has(veld)) fouten.push(`Onbekend veld "${veld}" in ${waar}.`);
      }
      if (!isTekst(importeur.id) || !IMPORTEUR_ID.test(importeur.id)) fouten.push(`${waar}.id moet kleine letters, cijfers en streepjes zijn.`);
      else if (ids.has(importeur.id)) fouten.push(`${waar}.id "${importeur.id}" komt twee keer voor.`);
      else ids.add(importeur.id);
      if (!isTekst(importeur.label)) fouten.push(`${waar}.label ontbreekt.`);
      if (!Array.isArray(importeur.fileExtensions) || importeur.fileExtensions.length === 0) {
        fouten.push(`${waar}.fileExtensions moet een lijst met minstens één bestandstype zijn.`);
      } else if (!importeur.fileExtensions.every((ext) => typeof ext === "string" && BESTANDSTYPE.test(ext))) {
        fouten.push(`${waar}.fileExtensions: kleine letters en cijfers, zonder punt (bijv. "demofem").`);
      }
      if (importeur.dimension !== "2d" && importeur.dimension !== "3d") fouten.push(`${waar}.dimension moet "2d" of "3d" zijn.`);
    });
  }
  if (fouten.length > 0) return { ok: false, fouten };
  return { ok: true, manifest: ruw as unknown as ExtensieManifest };
}

export interface ImportMelding { level: "info" | "warning"; text: string }
export interface ImportUitkomst { projectTekst: string; meldingen: ImportMelding[] }

/**
 * Keur wat `importFile` teruggaf: `{ project, messages }`. Het project gaat
 * door dezelfde lezer als Bestand → Openen; de tekst die terugkomt, is opnieuw
 * geschreven zoals Opslaan dat doet. Gooit een Error met de reden.
 */
export function keurImportResultaat(waarde: unknown): ImportUitkomst {
  if (!isObject(waarde)) throw new Error("De importeur gaf geen object terug ({ project, messages }).");
  if (!isObject(waarde.project)) throw new Error("De importeur gaf geen project terug.");
  const berichten = waarde.messages ?? [];
  if (!Array.isArray(berichten)) throw new Error("\"messages\" van de importeur is geen lijst.");
  const meldingen: ImportMelding[] = berichten.map((bericht, index) => {
    if (!isObject(bericht) || (bericht.level !== "info" && bericht.level !== "warning") || typeof bericht.text !== "string") {
      throw new Error(`messages[${index}] moet { level: "info" | "warning", text } zijn.`);
    }
    return { level: bericht.level, text: bericht.text };
  });
  let project: ProjectFile;
  try {
    project = deserializeProject(JSON.stringify(waarde.project));
  } catch (fout) {
    throw new Error(`Het project van de importeur is niet te lezen: ${fout instanceof Error ? fout.message : String(fout)}`);
  }
  const { format: _f, version: _v, savedAt: _s, ...inhoud } = project;
  return { projectTekst: serializeProject(inhoud), meldingen };
}

export interface GeladenExtensie { map: string; manifest: ExtensieManifest; ingeschakeld: boolean }

/** De importeurs die een bestand kunnen lezen, op bestandstype; met `importerId` alleen die. */
export function importeurVoorBestand(
  extensies: readonly GeladenExtensie[], bestandsnaam: string, importerId?: string,
): { extensie: GeladenExtensie; importeur: ExtensieImporteur }[] {
  const punt = bestandsnaam.lastIndexOf(".");
  const type = punt >= 0 ? bestandsnaam.slice(punt + 1).toLowerCase() : "";
  return extensies
    .filter((extensie) => extensie.ingeschakeld)
    .flatMap((extensie) => extensie.manifest.importers
      .filter((importeur) => importeur.fileExtensions.includes(type) && (importerId === undefined || importeur.id === importerId))
      .map((importeur) => ({ extensie, importeur })));
}

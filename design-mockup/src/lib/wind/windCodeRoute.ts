import {
  berekenStuwdruk, handmatigeStuwdruk,
  type StuwdrukResultaat, type TerreinCategorie, type Windgebied,
} from "./windEurocode";

/**
 * Stable identity for projects made with the existing Dutch calculation.
 * `legacy` is deliberate: its EN terrain profile and manual NB pressure
 * option do not establish one fully verified edition of the Dutch annex.
 */
export const NEDERLANDSE_WINDROUTE = "nl-en-1991-1-4-legacy" as const;
export type WindCodeId = typeof NEDERLANDSE_WINDROUTE;

export type WindPressureRequest = {
  codeId?: string;
  source: "calculated";
  windgebied: Windgebied;
  terreincategorie: TerreinCategorie;
} | {
  codeId?: string;
  source: "manual";
  pressureKnPerM2: number;
  /** Origin of the entered value, saved with the generated pressure. */
  pressureSource?: string;
};

/** Read the project basis without replacing an unknown saved route. */
export function windCodeIdFromProjectInfo(projectInfo: unknown): string {
  if (!projectInfo || typeof projectInfo !== "object") return NEDERLANDSE_WINDROUTE;
  const basis = (projectInfo as { uitgangspunten?: unknown }).uitgangspunten;
  if (!basis || typeof basis !== "object") return NEDERLANDSE_WINDROUTE;
  const codeId = (basis as { windCodeId?: unknown }).windCodeId;
  if (codeId === undefined || codeId === null) return NEDERLANDSE_WINDROUTE;
  return typeof codeId === "string" ? codeId : String(codeId);
}

/** Missing IDs belong to existing project files; unknown IDs never fall back to NL. */
export function requireWindCodeId(codeId: string | undefined): WindCodeId {
  const resolved = codeId ?? NEDERLANDSE_WINDROUTE;
  if (resolved !== NEDERLANDSE_WINDROUTE) {
    throw new Error(`Windnormroute ${resolved} is niet beschikbaar. Kies een geverifieerde route voor dit project.`);
  }
  return resolved;
}

/** First route adapter. Later codes add their own request variant and module. */
export function calculateWindReferencePressure(request: WindPressureRequest, heightM: number): StuwdrukResultaat {
  requireWindCodeId(request.codeId);
  if (request.source === "manual") return handmatigeStuwdruk(request.pressureKnPerM2, heightM, request.pressureSource);
  return berekenStuwdruk(request.windgebied, request.terreincategorie, heightM);
}

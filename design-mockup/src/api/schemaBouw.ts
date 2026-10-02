/**
 * Bouwstenen voor de invoerschema's van de API-commando's, zodat elk schema
 * dezelfde vorm heeft: een object altijd met `additionalProperties: false`,
 * een id altijd een geheel getal groter dan 0, en een beschrijving bij elk
 * veld (die ziet een AI in de MCP-tool).
 *
 * Zuiver: geen React, geen DOM. Gaat mee in de sidecarbundel.
 */
import type {
  ApiArraySchema, ApiBooleanSchema, ApiNullSchema, ApiNumberSchema, ApiObjectSchema, ApiOneOfSchema, ApiSchema, ApiStringSchema,
} from "./schema";

const metBeschrijving = <T extends object>(schema: T, beschrijving?: string): T =>
  beschrijving ? { ...schema, description: beschrijving } : schema;

export function obj(
  properties: Record<string, ApiSchema>, required: string[] = [], beschrijving?: string,
): ApiObjectSchema {
  return metBeschrijving({ type: "object", properties, ...(required.length ? { required } : {}), additionalProperties: false }, beschrijving);
}

export function getal(beschrijving?: string, grenzen: Omit<ApiNumberSchema, "type" | "description"> = {}): ApiNumberSchema {
  return metBeschrijving({ type: "number", ...grenzen }, beschrijving);
}

export function geheel(beschrijving?: string, grenzen: Omit<ApiNumberSchema, "type" | "description"> = {}): ApiNumberSchema {
  return metBeschrijving({ type: "integer", ...grenzen }, beschrijving);
}

/** Een id van een bestaand element: geheel getal groter dan 0. */
export function id(beschrijving: string): ApiNumberSchema {
  return geheel(beschrijving, { exclusiveMinimum: 0 });
}

export function tekst(beschrijving?: string, eisen: Omit<ApiStringSchema, "type" | "description"> = {}): ApiStringSchema {
  return metBeschrijving({ type: "string", ...eisen }, beschrijving);
}

export function keuze(waarden: string[], beschrijving?: string): ApiStringSchema {
  return metBeschrijving({ type: "string", enum: waarden }, beschrijving);
}

export function jaNee(beschrijving?: string): ApiBooleanSchema {
  return metBeschrijving({ type: "boolean" }, beschrijving);
}

export function lijst(items: ApiSchema, beschrijving?: string, grenzen: Pick<ApiArraySchema, "minItems" | "maxItems"> = {}): ApiArraySchema {
  return metBeschrijving({ type: "array", items, ...grenzen }, beschrijving);
}

/** Het schema óf null; null wist een optioneel veld. */
export function ofNull(schema: ApiSchema, beschrijving?: string): ApiOneOfSchema {
  const nul: ApiNullSchema = { type: "null" };
  return metBeschrijving({ oneOf: [schema, nul] }, beschrijving);
}

export function eenVan(varianten: ApiSchema[], beschrijving?: string): ApiOneOfSchema {
  return metBeschrijving({ oneOf: varianten }, beschrijving);
}

/**
 * De invoerschema's van de API-commando's: een vaste, kleine subset van JSON
 * Schema, met een eigen strenge validator (geen extra afhankelijkheid).
 *
 * Elk schema is tegelijk geldig JSON Schema: de MCP-server geeft het zo door
 * als `inputSchema` van de tool. Een object staat op elk niveau
 * `additionalProperties: false` toe; een tikfout in een veldnaam is dus een
 * fout en nooit een stille standaardwaarde.
 *
 * Zuiver: geen React, geen DOM. Gaat mee in de sidecarbundel.
 */

export type ApiSchema =
  | ApiObjectSchema
  | ApiArraySchema
  | ApiNumberSchema
  | ApiStringSchema
  | ApiBooleanSchema
  | ApiNullSchema
  | ApiConstSchema
  | ApiOneOfSchema;

export interface ApiObjectSchema {
  type: "object";
  properties: Record<string, ApiSchema>;
  required?: string[];
  additionalProperties: false;
  description?: string;
}
export interface ApiArraySchema {
  type: "array";
  items: ApiSchema;
  minItems?: number;
  maxItems?: number;
  description?: string;
}
export interface ApiNumberSchema {
  type: "number" | "integer";
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  description?: string;
}
export interface ApiStringSchema {
  type: "string";
  enum?: string[];
  minLength?: number;
  description?: string;
}
export interface ApiBooleanSchema { type: "boolean"; description?: string }
export interface ApiNullSchema { type: "null"; description?: string }
export interface ApiConstSchema { const: string | number | boolean; description?: string }
export interface ApiOneOfSchema { oneOf: ApiSchema[]; description?: string }

export interface SchemaProbleem {
  /** `.veld`, `[2].veld`; leeg voor de invoer zelf. */
  pad: string;
  melding: string;
}

const isObject = (waarde: unknown): waarde is Record<string, unknown> =>
  typeof waarde === "object" && waarde !== null && !Array.isArray(waarde);

/** Alle problemen van `waarde` tegen `schema`, elk met zijn pad. Leeg = geldig. */
export function valideer(schema: ApiSchema, waarde: unknown, pad = ""): SchemaProbleem[] {
  const problemen: SchemaProbleem[] = [];
  const meld = (melding: string, waar = pad) => problemen.push({ pad: waar, melding });

  if ("oneOf" in schema) {
    const passend = schema.oneOf.filter((variant) => valideer(variant, waarde, pad).length === 0).length;
    if (passend === 0) meld("past bij geen van de toegestane vormen");
    else if (passend > 1) meld("past bij meer dan één toegestane vorm");
    return problemen;
  }
  if ("const" in schema) {
    if (waarde !== schema.const) meld(`moet precies ${JSON.stringify(schema.const)} zijn`);
    return problemen;
  }

  switch (schema.type) {
    case "object": {
      if (!isObject(waarde)) { meld("verwacht een object"); break; }
      for (const veld of schema.required ?? []) {
        if (waarde[veld] === undefined) meld("verplicht veld ontbreekt", `${pad}.${veld}`);
      }
      for (const [veld, inhoud] of Object.entries(waarde)) {
        if (inhoud === undefined) continue;
        const sub = schema.properties[veld];
        if (!sub) {
          meld(`onbekend veld; toegestaan: ${Object.keys(schema.properties).join(", ") || "(geen)"}`, `${pad}.${veld}`);
          continue;
        }
        problemen.push(...valideer(sub, inhoud, `${pad}.${veld}`));
      }
      break;
    }
    case "array": {
      if (!Array.isArray(waarde)) { meld("verwacht een lijst"); break; }
      if (schema.minItems !== undefined && waarde.length < schema.minItems) {
        meld(`moet minstens ${schema.minItems} elementen hebben`);
      }
      if (schema.maxItems !== undefined && waarde.length > schema.maxItems) {
        meld(`mag hoogstens ${schema.maxItems} elementen hebben`);
      }
      waarde.forEach((element, index) => problemen.push(...valideer(schema.items, element, `${pad}[${index}]`)));
      break;
    }
    case "number":
    case "integer": {
      if (typeof waarde !== "number" || !Number.isFinite(waarde)) { meld("verwacht een (eindig) getal"); break; }
      if (schema.type === "integer" && !Number.isInteger(waarde)) { meld("verwacht een geheel getal"); break; }
      if (schema.minimum !== undefined && waarde < schema.minimum) meld(`moet minstens ${schema.minimum} zijn`);
      if (schema.maximum !== undefined && waarde > schema.maximum) meld(`mag hoogstens ${schema.maximum} zijn`);
      if (schema.exclusiveMinimum !== undefined && waarde <= schema.exclusiveMinimum) {
        meld(`moet groter zijn dan ${schema.exclusiveMinimum}`);
      }
      if (schema.exclusiveMaximum !== undefined && waarde >= schema.exclusiveMaximum) {
        meld(`moet kleiner zijn dan ${schema.exclusiveMaximum}`);
      }
      break;
    }
    case "string": {
      if (typeof waarde !== "string") { meld("verwacht tekst"); break; }
      if (schema.enum && !schema.enum.includes(waarde)) meld(`moet een van deze waarden zijn: ${schema.enum.join(", ")}`);
      if (schema.minLength !== undefined && waarde.length < schema.minLength) {
        meld(`moet minstens ${schema.minLength} teken${schema.minLength === 1 ? "" : "s"} lang zijn`);
      }
      break;
    }
    case "boolean":
      if (typeof waarde !== "boolean") meld("verwacht ja/nee (true of false)");
      break;
    case "null":
      if (waarde !== null) meld("verwacht null");
      break;
  }
  return problemen;
}

/**
 * De paden van elk object in `schema` zonder `additionalProperties: false`.
 * Leeg = streng op elk niveau. Voor schema's die niet door de typecontrole
 * zijn gegaan (bijvoorbeeld de catalogus zoals Rust hem ontvangt).
 */
export function isStrikt(schema: ApiSchema, pad = ""): string[] {
  if ("oneOf" in schema) return schema.oneOf.flatMap((variant) => isStrikt(variant, pad));
  if ("const" in schema) return [];
  if (schema.type === "array") return isStrikt(schema.items, `${pad}[]`);
  if (schema.type !== "object") return [];
  const eigen = (schema as { additionalProperties?: unknown }).additionalProperties === false ? [] : [pad];
  return [...eigen, ...Object.entries(schema.properties ?? {}).flatMap(([veld, sub]) => isStrikt(sub, `${pad}.${veld}`))];
}

/** Analysemodulus en dwarscontractie per 3D-materiaal (issue #62). */
import { CONCRETE_E_CM } from "../../lib/sectionResolver";
import type { OpenFem3DModel } from "./openFem3dModel";

export type OpenFem3DConcreteModulus =
  | { kind: "ecm" }
  | { kind: "creep"; phi: number }
  | { kind: "custom"; eMpa: number };

export interface OpenFem3DAnalysisMaterial {
  concreteModulus?: OpenFem3DConcreteModulus;
  /** Dwarscontractiecoëfficiënt voor de isotrope 3D-analyse. */
  nu?: number;
}

export type OpenFem3DAnalysisMaterials = Record<string, OpenFem3DAnalysisMaterial>;

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** Bestand/API-grens: een onbekende instelling mag nooit stil wegvallen. */
export function readOpenFem3DAnalysisMaterials(raw: unknown): OpenFem3DAnalysisMaterials | undefined {
  if (raw === undefined) return undefined;
  if (!object(raw)) throw new Error("De 3D-analysematerialen moeten een object zijn.");
  const entries: OpenFem3DAnalysisMaterials = {};
  for (const [name, value] of Object.entries(raw)) {
    if (!name.trim() || name !== name.trim() || ["__proto__", "prototype", "constructor"].includes(name) || !object(value)) {
      throw new Error(`3D-analysemateriaal ${JSON.stringify(name)} is ongeldig.`);
    }
    const extra = Object.keys(value).filter((key) => !["concreteModulus", "nu"].includes(key));
    if (extra.length) throw new Error(`3D-analysemateriaal ${name}: onbekend veld ${extra.join(", ")}.`);
    const entry: OpenFem3DAnalysisMaterial = {};
    if (value.nu !== undefined) {
      if (typeof value.nu !== "number" || !Number.isFinite(value.nu) || value.nu < 0 || value.nu >= 0.5) {
        throw new Error(`3D-analysemateriaal ${name}: ν moet tussen 0 en 0,5 liggen (0,5 uitgezonderd).`);
      }
      entry.nu = value.nu;
    }
    if (value.concreteModulus !== undefined) {
      const modulus = value.concreteModulus;
      if (!Object.prototype.hasOwnProperty.call(CONCRETE_E_CM, name) || !object(modulus)) {
        throw new Error(`3D-analysemateriaal ${name}: een E-keuze is alleen voor een bekende betonklasse beschikbaar.`);
      }
      const kind = modulus.kind;
      const allowed = kind === "creep" ? ["kind", "phi"] : kind === "custom" ? ["kind", "eMpa"] : ["kind"];
      if (!["ecm", "creep", "custom"].includes(String(kind))
        || Object.keys(modulus).some((key) => !allowed.includes(key))) {
        throw new Error(`3D-analysemateriaal ${name}: ongeldige E-keuze.`);
      }
      if (kind === "creep") {
        if (typeof modulus.phi !== "number" || !Number.isFinite(modulus.phi) || modulus.phi < 0) {
          throw new Error(`3D-analysemateriaal ${name}: kruipcoëfficiënt φ moet eindig en niet-negatief zijn.`);
        }
        entry.concreteModulus = { kind: "creep", phi: modulus.phi };
      } else if (kind === "custom") {
        if (typeof modulus.eMpa !== "number" || !Number.isFinite(modulus.eMpa) || modulus.eMpa <= 0) {
          throw new Error(`3D-analysemateriaal ${name}: eigen E moet positief en eindig zijn.`);
        }
        entry.concreteModulus = { kind: "custom", eMpa: modulus.eMpa };
      } else entry.concreteModulus = { kind: "ecm" };
    }
    if (Object.keys(entry).length > 0) entries[name] = entry;
  }
  return Object.keys(entries).length > 0 ? entries : undefined;
}

export function setOpenFem3DAnalysisMaterial(
  model: OpenFem3DModel, material: string, input: OpenFem3DAnalysisMaterial | null,
): OpenFem3DModel {
  const name = material.trim();
  const next = { ...(model.analysisMaterials ?? {}) };
  if (input === null || Object.keys(input).length === 0) delete next[name];
  else {
    const valid = readOpenFem3DAnalysisMaterials({ [name]: input });
    next[name] = valid![name];
  }
  return { ...model, ...(Object.keys(next).length > 0 ? { analysisMaterials: next } : { analysisMaterials: undefined }) };
}

export function resolveOpenFem3DAnalysisMaterial(
  material: string, baseEMpa: number, baseNu: number, model: Pick<OpenFem3DModel, "analysisMaterials">,
): { eMpa: number; nu: number; source: OpenFem3DConcreteModulus["kind"] | "default" } {
  const settings = model.analysisMaterials?.[material];
  const choice = settings?.concreteModulus;
  const eMpa = choice?.kind === "creep" ? baseEMpa / (1 + choice.phi)
    : choice?.kind === "custom" ? choice.eMpa : baseEMpa;
  return { eMpa, nu: settings?.nu ?? baseNu, source: choice?.kind ?? "default" };
}

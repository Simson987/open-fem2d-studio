/**
 * Plaatuitkomsten in het 3D-rapport over alle combinaties (issue #197):
 *
 *  1. De OMHULLENDE per plaat en per grootheid (w, m, n, v, von Mises en, op
 *     bedding, gronddruk en zakking): het kleinste en grootste knoopresultaat
 *     over de werkelijk doorgerekende combinaties, apart voor UGT en BGT, met
 *     de combinatie en de knoop waar het optreedt. Dezelfde uitersten per
 *     combinatie als het rapport per plaat al toont (`openFem3DPlateExtremes`).
 *  2. De RANDREACTIES per plaat: per rand met een randoplegging de som van de
 *     oplegreacties op de rekenknopen van die rand (F_x, F_y, F_z in globale
 *     assen, kN), en de som over de hele plaat; per combinatie en als
 *     omhullende.
 *
 * Afspraken bij de randreacties:
 *  - Een hoekknoop die op twee opgelegde randen ligt, telt voor elk de helft:
 *    zo is de som van de randen precies de plaatsom, en telt geen reactie
 *    dubbel.
 *  - Een knoop draagt zijn hele reactie bij, ook als er daarnaast een eigen
 *    puntoplegging op staat (de kern geeft één reactie per knoop).
 *  - Een ontbrekend combinatieresultaat telt niet als nul; een resultaat
 *    zonder rekennet (`plateMesh`) geeft geen randreacties.
 */
import type { LoadCombination } from "../fem/solver/combinations";
import type { OpenFem3DModel } from "./openFem3dModel";
import type { OpenFem3DSolveResult } from "./openFem3dSolver";
import { OPEN_FEM_3D_PLATE_QUANTITIES, openFem3DPlateExtremes, type OpenFem3DPlateQuantity } from "./openFem3dPlateResults";

export type PlaatSoort = "uls" | "sls";

export interface PlaatPunt {
  waarde: number;
  combinatieId: number;
  combinatie: string;
  /** Knoop waar de plaatwaarde optreedt; niet bij een randreactie. */
  knoopId?: number;
}

export interface OpenFem3DPlaatOmhullendeRij {
  soort: PlaatSoort;
  plateId: number;
  grootheid: OpenFem3DPlateQuantity;
  symbool: string;
  eenheid: string;
  combinatieIds: Set<number>;
  min: PlaatPunt;
  max: PlaatPunt;
}

/** De omhullende per plaat en grootheid, per grenstoestand. */
export function openFem3DPlaatOmhullenden(
  combinaties: readonly Pick<LoadCombination, "id" | "name" | "type">[],
  resultaten: ReadonlyMap<number, OpenFem3DSolveResult>,
): OpenFem3DPlaatOmhullendeRij[] {
  const rijen = new Map<string, OpenFem3DPlaatOmhullendeRij>();
  for (const combinatie of combinaties) {
    const resultaat = resultaten.get(combinatie.id);
    if (!resultaat) continue;
    for (const plaat of resultaat.plates ?? []) {
      for (const e of openFem3DPlateExtremes(resultaat, plaat.plateId)) {
        if (!Number.isFinite(e.min) || !Number.isFinite(e.max)) continue;
        const sleutel = `${combinatie.type}:${plaat.plateId}:${e.definition.key}`;
        const min: PlaatPunt = { waarde: e.min, combinatieId: combinatie.id, combinatie: combinatie.name, knoopId: e.minNodeId };
        const max: PlaatPunt = { waarde: e.max, combinatieId: combinatie.id, combinatie: combinatie.name, knoopId: e.maxNodeId };
        const rij = rijen.get(sleutel);
        if (!rij) {
          rijen.set(sleutel, {
            soort: combinatie.type, plateId: plaat.plateId, grootheid: e.definition.key,
            symbool: e.definition.symbol, eenheid: e.definition.unit,
            combinatieIds: new Set([combinatie.id]), min, max,
          });
        } else {
          rij.combinatieIds.add(combinatie.id);
          if (min.waarde < rij.min.waarde) rij.min = min;
          if (max.waarde > rij.max.waarde) rij.max = max;
        }
      }
    }
  }
  const volgorde = new Map(OPEN_FEM_3D_PLATE_QUANTITIES.map((d, i) => [d.key as string, i]));
  return [...rijen.values()].sort((a, b) =>
    (a.soort === b.soort ? 0 : a.soort === "uls" ? -1 : 1)
    || a.plateId - b.plateId
    || (volgorde.get(a.grootheid) ?? 0) - (volgorde.get(b.grootheid) ?? 0));
}

/** De reactiesom op één rand (of, met `rand: null`, op de hele plaat). */
export interface OpenFem3DPlaatRandreactie {
  plateId: number;
  /** Rand k (0-gebaseerd, zoals `edgeSupports[].edge`); null = de hele plaat. */
  rand: number | null;
  knoopIds: number[];
  fx: number;
  fy: number;
  fz: number;
}

/** Per plaat met randopleggingen: de som per opgelegde rand en over de plaat. */
export function openFem3DPlaatRandreacties(
  model: Pick<OpenFem3DModel, "plates">,
  resultaat: Pick<OpenFem3DSolveResult, "reactions" | "plateMesh">,
): OpenFem3DPlaatRandreactie[] {
  const mesh = resultaat.plateMesh;
  if (!mesh) return [];
  const reactie = new Map(resultaat.reactions.map((r) => [r.nodeId, r]));
  const uit: OpenFem3DPlaatRandreactie[] = [];
  for (const plaat of model.plates ?? []) {
    const randen = [...new Set((plaat.edgeSupports ?? []).map((s) => s.edge))].sort((a, b) => a - b);
    if (randen.length === 0) continue;
    const knopenPerRand = randen.map((rand) => [...new Set(mesh.plateEdgeNodes.get(plaat.id)?.[rand] ?? [])]);
    // Op hoeveel opgelegde randen ligt elke knoop: zoveel delen van zijn reactie.
    const aantal = new Map<number, number>();
    for (const knopen of knopenPerRand) for (const id of knopen) aantal.set(id, (aantal.get(id) ?? 0) + 1);
    const totaal: OpenFem3DPlaatRandreactie = { plateId: plaat.id, rand: null, knoopIds: [...aantal.keys()].sort((a, b) => a - b), fx: 0, fy: 0, fz: 0 };
    randen.forEach((rand, i) => {
      const rij: OpenFem3DPlaatRandreactie = { plateId: plaat.id, rand, knoopIds: knopenPerRand[i], fx: 0, fy: 0, fz: 0 };
      for (const id of knopenPerRand[i]) {
        const r = reactie.get(id);
        if (!r) continue;
        const deel = 1 / (aantal.get(id) ?? 1);
        rij.fx += r.fx * deel; rij.fy += r.fy * deel; rij.fz += r.fz * deel;
      }
      uit.push(rij);
    });
    for (const id of totaal.knoopIds) {
      const r = reactie.get(id);
      if (!r) continue;
      totaal.fx += r.fx; totaal.fy += r.fy; totaal.fz += r.fz;
    }
    uit.push(totaal);
  }
  return uit;
}

export interface OpenFem3DPlaatRandreactieRij {
  soort: PlaatSoort;
  plateId: number;
  rand: number | null;
  grootheid: "Fx" | "Fy" | "Fz";
  combinatieIds: Set<number>;
  min: PlaatPunt;
  max: PlaatPunt;
}

/** De omhullende van de randreacties over de combinaties, per grenstoestand. */
export function openFem3DPlaatRandreactieOmhullenden(
  model: Pick<OpenFem3DModel, "plates">,
  combinaties: readonly Pick<LoadCombination, "id" | "name" | "type">[],
  resultaten: ReadonlyMap<number, OpenFem3DSolveResult>,
): OpenFem3DPlaatRandreactieRij[] {
  const rijen = new Map<string, OpenFem3DPlaatRandreactieRij>();
  for (const combinatie of combinaties) {
    const resultaat = resultaten.get(combinatie.id);
    if (!resultaat) continue;
    for (const som of openFem3DPlaatRandreacties(model, resultaat)) {
      for (const [grootheid, waarde] of [["Fx", som.fx], ["Fy", som.fy], ["Fz", som.fz]] as const) {
        if (!Number.isFinite(waarde)) continue;
        const sleutel = `${combinatie.type}:${som.plateId}:${som.rand ?? "plaat"}:${grootheid}`;
        const punt: PlaatPunt = { waarde, combinatieId: combinatie.id, combinatie: combinatie.name };
        const rij = rijen.get(sleutel);
        if (!rij) {
          rijen.set(sleutel, {
            soort: combinatie.type, plateId: som.plateId, rand: som.rand, grootheid,
            combinatieIds: new Set([combinatie.id]), min: punt, max: punt,
          });
        } else {
          rij.combinatieIds.add(combinatie.id);
          if (waarde < rij.min.waarde) rij.min = punt;
          if (waarde > rij.max.waarde) rij.max = punt;
        }
      }
    }
  }
  return [...rijen.values()];
}

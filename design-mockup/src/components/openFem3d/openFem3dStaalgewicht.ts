/**
 * Het staalgewicht van een 3D-model: ρ·A·L per stalen staaf.
 *
 * Doorsnede (A bruto) en dichtheid komen uit dezelfde bron als het eigen
 * gewicht (`withOpenFem3DSelfWeight`), zodat het getal in het venster en de
 * belasting uit eigen gewicht altijd bij elkaar passen. Een staaf telt als
 * staal als zijn materiaal een staalsoort is (S235 … S460).
 *
 * Puur: geen React, geen DOM.
 */
import { dichtheidVanMateriaal, resolveSection } from "../../lib/sectionResolver";
import { STEEL_GRADES } from "../../lib/steelGrades";
import type { OpenFem3DModel } from "./openFem3dModel";

export interface OpenFem3DStaalProfiel {
  profiel: string;
  staalsoort: string;
  aantal: number;
  lengteM: number;
  kg: number;
}

export interface OpenFem3DStaalgewicht {
  totaalKg: number;
  /** Aantal stalen staven dat meetelt. */
  aantalStaven: number;
  /** Per profiel en staalsoort, zwaarste eerst. */
  perProfiel: OpenFem3DStaalProfiel[];
  /** Stalen staven waarvan de doorsnede onbekend is: zij tellen niet mee. */
  onbekend: number[];
}

const isStaal = (materiaal: string | undefined) =>
  materiaal !== undefined && STEEL_GRADES.includes(materiaal.trim().toUpperCase());

export function openFem3DStaalgewicht(model: Pick<OpenFem3DModel, "nodes" | "beams">): OpenFem3DStaalgewicht {
  const knoop = new Map(model.nodes.map((n) => [n.id, n]));
  const groepen = new Map<string, OpenFem3DStaalProfiel>();
  const onbekend: number[] = [];
  let totaalKg = 0;
  let aantalStaven = 0;
  for (const beam of model.beams) {
    if (!isStaal(beam.material)) continue;
    const a = knoop.get(beam.startNodeId), b = knoop.get(beam.endNodeId);
    const profiel = beam.profileName?.trim() ?? "";
    const resolved = resolveSection(beam.material!.trim(), profiel);
    if (!a || !b || resolved.bron === "default") { onbekend.push(beam.id); continue; }
    const lengteM = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    const kg = dichtheidVanMateriaal(beam.material) * (resolved.aBruto ?? resolved.A) * 1e-6 * lengteM;
    totaalKg += kg;
    aantalStaven += 1;
    const staalsoort = beam.material!.trim().toUpperCase();
    const sleutel = `${profiel}\u0000${staalsoort}`;
    const groep = groepen.get(sleutel) ?? { profiel, staalsoort, aantal: 0, lengteM: 0, kg: 0 };
    groep.aantal += 1;
    groep.lengteM += lengteM;
    groep.kg += kg;
    groepen.set(sleutel, groep);
  }
  return {
    totaalKg,
    aantalStaven,
    perProfiel: [...groepen.values()].sort((p, q) => q.kg - p.kg),
    onbekend,
  };
}

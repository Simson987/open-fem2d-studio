/**
 * Het staalgewicht van een 3D-model: ρ·A·L per stalen staaf.
 *
 * Doorsnede (A bruto) en dichtheid komen uit dezelfde bron als het eigen
 * gewicht (`withOpenFem3DSelfWeight`), zodat het getal in het venster en de
 * belasting uit eigen gewicht altijd bij elkaar passen. Een staaf telt als
 * staal als zijn materiaal een staalsoort is (S235 … S460).
 *
 * Een verlopende staaf (#73) weegt met de gemiddelde massa van haar gelijke
 * delen (elk de A van zijn midden, zoals het eigen gewicht en de kern) en
 * staat als eigen regel "begin → eind".
 *
 * Puur: geen React, geen DOM.
 */
import { dichtheidVanMateriaal, resolveSection } from "../../lib/sectionResolver";
import { STEEL_GRADES } from "../../lib/steelGrades";
import type { OpenFem3DModel } from "./openFem3dModel";
import { openFem3DProfielTekst, openFem3DVerloopDelen } from "./openFem3dVerloop";

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
    const resolved = resolveSection(beam.material!.trim(), beam.profileName?.trim() ?? "");
    if (!a || !b || resolved.bron === "default") { onbekend.push(beam.id); continue; }
    const lengteM = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    let indeling: ReturnType<typeof openFem3DVerloopDelen>;
    try { indeling = openFem3DVerloopDelen(beam, lengteM); } catch { onbekend.push(beam.id); continue; }
    const profiel = indeling ? openFem3DProfielTekst(beam) : beam.profileName?.trim() ?? "";
    const areaMm2 = indeling
      ? indeling.delen.reduce((som, deel) => som + deel.doorsnede.areaMm2 * (deel.tEnd - deel.tStart), 0)
      : resolved.aBruto ?? resolved.A;
    const kg = dichtheidVanMateriaal(beam.material) * areaMm2 * 1e-6 * lengteM;
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

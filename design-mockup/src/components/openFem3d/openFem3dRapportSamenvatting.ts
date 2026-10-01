/**
 * Samenvattingen voor het 3D-rapport van een groot model: de horizontale
 * verplaatsing in de BGT tegen h/300 en de unity checks per staafgroep.
 *
 * Puur: geen React, geen DOM.
 */
import type { LoadCombination } from "../fem/solver/combinations";
import type { BeamCheckResult } from "../../lib/types/steel/BeamCheckResult";
import type { OpenFem3DModel } from "./openFem3dModel";
import type { OpenFem3DSolveResult } from "./openFem3dSolver";
import { checkUc, openFem3DGoverningUlsCheck, openFem3DUlsUc } from "./openFem3dSteelCheck";

/** Standaardgrens voor de horizontale verplaatsing van een gebouw: h/300. */
export const HORIZONTAAL_GRENS_NOEMER = 300;

export interface OpenFem3DHorizontaleVerplaatsing {
  combinationId: number;
  naam: string;
  /** Knoop met de grootste verhouding u_hor / (h/300). */
  nodeId: number;
  nodeNaam?: string;
  uxMm: number;
  uyMm: number;
  uHorMm: number;
  /** Hoogte van de knoop boven de voet (laagste oplegging), m. */
  hoogteM: number;
  grensMm: number;
  uc: number;
}

/**
 * Per BGT-combinatie de knoop waar de horizontale verplaatsing het dichtst bij
 * (of het verst boven) h/300 komt. h is de hoogte van die knoop boven de voet
 * (de laagste oplegging), dus bij een gebouw van twee verdiepingen telt een
 * knoop op de eerste vloer met zijn eigen hoogte. Knopen op of onder de voet
 * (tot 0,1 m erboven) tellen niet mee.
 *
 * h/300 is een eis aan een verdieping of het gebouw (NEN-EN 1990 NB A1.4.3(7)),
 * niet aan een knoop halverwege een kolom of gevelstijl: zo'n knoop verplaatst
 * door de buiging van die staaf. Heeft het model bouwlagen (een knoop met een
 * level) of schijven, dan tellen daarom alleen knopen op een bouwlaag of in een
 * schijf mee. Zonder bouwlagen en schijven tellen alle knopen.
 */
export function openFem3DHorizontaleVerplaatsingen(
  model: Pick<OpenFem3DModel, "nodes" | "supports"> & Partial<Pick<OpenFem3DModel, "diaphragms">>,
  combinations: readonly LoadCombination[],
  results: ReadonlyMap<number, OpenFem3DSolveResult>,
  noemer = HORIZONTAAL_GRENS_NOEMER,
): OpenFem3DHorizontaleVerplaatsing[] {
  const knoop = new Map(model.nodes.map((n) => [n.id, n]));
  const voetZ = Math.min(...(model.supports ?? []).map((s) => knoop.get(s.nodeId)?.z ?? Infinity));
  const inSchijf = new Set((model.diaphragms ?? []).flatMap((d) => d.nodeIds));
  const heeftBouwlagen = inSchijf.size > 0 || model.nodes.some((n) => n.levelId);
  const telt = (n: (typeof model.nodes)[number]) => !heeftBouwlagen || Boolean(n.levelId) || inSchijf.has(n.id);
  if (!Number.isFinite(voetZ)) return [];
  const uit: OpenFem3DHorizontaleVerplaatsing[] = [];
  for (const combinatie of combinations) {
    if (combinatie.type !== "sls") continue;
    const result = results.get(combinatie.id);
    if (!result) continue;
    let beste: OpenFem3DHorizontaleVerplaatsing | null = null;
    for (const d of result.displacements) {
      const n = knoop.get(d.nodeId);
      if (!n || !telt(n)) continue;
      const hoogteM = n.z - voetZ;
      if (hoogteM <= 0.1) continue;
      const uHorMm = Math.hypot(d.ux, d.uy) * 1000;
      const grensMm = hoogteM * 1000 / noemer;
      const uc = uHorMm / grensMm;
      if (!beste || uc > beste.uc) {
        beste = {
          combinationId: combinatie.id, naam: combinatie.name, nodeId: n.id,
          ...(n.name ? { nodeNaam: n.name } : {}),
          uxMm: d.ux * 1000, uyMm: d.uy * 1000, uHorMm, hoogteM, grensMm, uc,
        };
      }
    }
    if (beste) uit.push(beste);
  }
  return uit;
}

export interface OpenFem3DUcGroep {
  groep: string;
  profiel: string;
  staalsoort: string;
  aantal: number;
  /** Grootste UC in de uiterste grenstoestand (sterkte en stabiliteit). */
  ucMax: number;
  maatgevendeStaaf: number;
  maatgevendeStaafNaam?: string;
  maatgevendeToets: string;
  /** Grootste UC van de doorbuigingstoetsen (BGT); null zonder doorbuigingstoets. */
  doorbuigingUcMax: number | null;
  /** Aantal staven in de groep met een UGT-UC boven 1. */
  aantalOverschreden: number;
}

/**
 * Unity checks per groep en profiel: een groot model heeft honderden staven,
 * en de vraag is per onderdeel "welk profiel, hoe zwaar belast". De groep komt
 * uit `beam.group` (bijvoorbeeld uit een IFC-analysemodel); zonder groep telt
 * de staaf onder "—". Gesorteerd op groep en dan op UC, zwaarste eerst.
 */
export function openFem3DUcPerGroep(
  model: Pick<OpenFem3DModel, "beams">,
  results: readonly BeamCheckResult[],
): OpenFem3DUcGroep[] {
  const staaf = new Map(model.beams.map((b) => [b.id, b]));
  const groepen = new Map<string, OpenFem3DUcGroep>();
  for (const r of results) {
    const beam = staaf.get(r.beam_id);
    const groep = beam?.group?.trim() || "—";
    const sleutel = `${groep}\u0000${r.profile_name}\u0000${r.steel_grade}`;
    const uc = openFem3DUlsUc(r);
    const toets = openFem3DGoverningUlsCheck(r);
    const doorbuiging = r.checks
      .filter((c) => c.id.startsWith("deflection_"))
      .map((c) => checkUc(c))
      .filter((v): v is number => v !== null);
    const doorbuigingUc = doorbuiging.length > 0 ? Math.max(...doorbuiging) : null;
    const huidig = groepen.get(sleutel);
    if (!huidig) {
      groepen.set(sleutel, {
        groep, profiel: r.profile_name, staalsoort: r.steel_grade, aantal: 1,
        ucMax: uc, maatgevendeStaaf: r.beam_id,
        ...(beam?.name ? { maatgevendeStaafNaam: beam.name } : {}),
        maatgevendeToets: toets?.id ?? "—",
        doorbuigingUcMax: doorbuigingUc, aantalOverschreden: uc > 1 ? 1 : 0,
      });
      continue;
    }
    huidig.aantal += 1;
    if (uc > 1) huidig.aantalOverschreden += 1;
    if (doorbuigingUc !== null) huidig.doorbuigingUcMax = Math.max(huidig.doorbuigingUcMax ?? 0, doorbuigingUc);
    if (uc > huidig.ucMax) {
      huidig.ucMax = uc;
      huidig.maatgevendeStaaf = r.beam_id;
      if (beam?.name) huidig.maatgevendeStaafNaam = beam.name; else delete huidig.maatgevendeStaafNaam;
      huidig.maatgevendeToets = toets?.id ?? "—";
    }
  }
  return [...groepen.values()].sort((a, b) => a.groep.localeCompare(b.groep, "nl") || b.ucMax - a.ucMax);
}

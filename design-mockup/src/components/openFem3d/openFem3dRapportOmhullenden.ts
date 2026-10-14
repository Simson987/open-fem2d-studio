/** Maatgevende waarden voor het 3D-rapport, uit de werkelijk doorgerekende combinaties. */
import type { LoadCombination } from "../fem/solver/combinations";
import type { OpenFem3DBeam, OpenFem3DModel, OpenFem3DNode } from "./openFem3dModel";
import type { OpenFem3DDiagrams, OpenFem3DSolveResult } from "./openFem3dSolver";

export type OmhullendeSoort = "uls" | "sls";
export type OmhullendeGroep = "staaf" | "reactie" | "verplaatsing";

export interface OmhullendePunt {
  waarde: number;
  combinatieId: number;
  combinatie: string;
  /** Afstand vanaf het begin van de staaf; alleen voor staafkrachten. */
  positieM?: number;
}

export interface OpenFem3DOmhullendeRij {
  soort: OmhullendeSoort;
  groep: OmhullendeGroep;
  id: number;
  grootheid: string;
  eenheid: "kN" | "kNm" | "mm" | "mrad";
  /** Combinaties waarvoor deze component werkelijk beschikbaar was. */
  combinatieIds: Set<number>;
  min: OmhullendePunt;
  max: OmhullendePunt;
}

export interface OpenFem3DDoorlopendeRij extends Omit<OpenFem3DOmhullendeRij, "groep" | "id" | "combinatieIds"> {
  naam: string;
  deelIds: number[];
  lengteM: number;
}

const KRACHTEN = [
  ["N", "axial", "nStartKn", "nEndKn", "kN"],
  ["Vy", "shearY", "vyStartKn", "vyEndKn", "kN"],
  ["Vz", "shearZ", "vzStartKn", "vzEndKn", "kN"],
  ["T", "torsion", "torsionStartKnm", "torsionEndKnm", "kNm"],
  ["My", "momentY", "myStartKnm", "myEndKnm", "kNm"],
  ["Mz", "momentZ", "mzStartKnm", "mzEndKnm", "kNm"],
] as const;
const REACTIES = [
  ["Fx", "fx", "kN"], ["Fy", "fy", "kN"], ["Fz", "fz", "kN"],
  ["Mx", "mx", "kNm"], ["My", "my", "kNm"], ["Mz", "mz", "kNm"],
] as const;
const VERPLAATSINGEN = [
  ["Ux", "ux", "mm"], ["Uy", "uy", "mm"], ["Uz", "uz", "mm"],
  ["Rx", "rx", "mrad"], ["Ry", "ry", "mrad"], ["Rz", "rz", "mrad"],
] as const;

/**
 * Min/max per staaf of knoop, per component en per grenstoestand. Voor staven
 * tellen alle solverstations mee: een veldmoment tussen de eindknopen mag niet
 * verdwijnen doordat alleen de begin- en eindkracht in de tabel staan.
 * Ontbrekende combinatieresultaten worden nooit als nul geïnterpreteerd.
 */
export function openFem3DRapportOmhullenden(
  combinaties: readonly Pick<LoadCombination, "id" | "name" | "type">[],
  resultaten: ReadonlyMap<number, OpenFem3DSolveResult>,
): OpenFem3DOmhullendeRij[] {
  const rijen = new Map<string, OpenFem3DOmhullendeRij>();
  const neem = (soort: OmhullendeSoort, groep: OmhullendeGroep, id: number,
    grootheid: string, eenheid: OpenFem3DOmhullendeRij["eenheid"],
    waarde: number, combinatieId: number, combinatie: string, positieM?: number) => {
    if (!Number.isFinite(waarde)) return;
    const sleutel = `${soort}:${groep}:${id}:${grootheid}`;
    const punt: OmhullendePunt = {
      waarde, combinatieId, combinatie,
      ...(positieM === undefined ? {} : { positieM }),
    };
    const rij = rijen.get(sleutel);
    if (!rij) {
      rijen.set(sleutel, { soort, groep, id, grootheid, eenheid, combinatieIds: new Set([combinatieId]), min: punt, max: punt });
    } else {
      rij.combinatieIds.add(combinatieId);
      if (waarde < rij.min.waarde) rij.min = punt;
      if (waarde > rij.max.waarde) rij.max = punt;
    }
  };

  for (const combinatie of combinaties) {
    const resultaat = resultaten.get(combinatie.id);
    if (!resultaat) continue;
    // Eén index per diagramsoort en combinatie. Zo blijft ook een rapport met
    // honderden staven en combinaties lineair in het aantal solverstations.
    const diagrammen = new Map<keyof OpenFem3DDiagrams, Map<number, { points: { t: number; value: number }[] }>>(
      KRACHTEN.map(([, sleutel]) => [sleutel, new Map(
        (resultaat.diagrams?.[sleutel] ?? []).map((lijn) => [lijn.memberId, lijn]),
      )]),
    );
    for (const staaf of resultaat.memberForces) {
      for (const [naam, sleutel, begin, eind, eenheid] of KRACHTEN) {
        const punten = diagrammen.get(sleutel)?.get(staaf.memberId)?.points;
        const stations = punten && punten.length >= 2 ? punten : [
          { t: 0, value: staaf[begin] }, { t: 1, value: staaf[eind] },
        ];
        for (const station of stations) {
          neem(combinatie.type, "staaf", staaf.memberId, naam, eenheid,
            station.value, combinatie.id, combinatie.name, station.t * staaf.lengthM);
        }
      }
    }
    for (const reactie of resultaat.reactions) {
      for (const [naam, sleutel, eenheid] of REACTIES) {
        neem(combinatie.type, "reactie", reactie.nodeId, naam, eenheid,
          reactie[sleutel], combinatie.id, combinatie.name);
      }
    }
    for (const verplaatsing of resultaat.displacements) {
      for (const [naam, sleutel, eenheid] of VERPLAATSINGEN) {
        neem(combinatie.type, "verplaatsing", verplaatsing.nodeId, naam, eenheid,
          verplaatsing[sleutel] * 1000, combinatie.id, combinatie.name);
      }
    }
  }
  const groepVolgorde = { staaf: 0, reactie: 1, verplaatsing: 2 };
  const grootheidVolgorde = new Map<string, number>(
    [...KRACHTEN, ...REACTIES, ...VERPLAATSINGEN].map(([naam], index) => [naam, index]),
  );
  return [...rijen.values()].sort((a, b) =>
    (a.soort === b.soort ? 0 : a.soort === "uls" ? -1 : 1) ||
    groepVolgorde[a.groep] - groepVolgorde[b.groep] || a.id - b.id ||
    (grootheidVolgorde.get(a.grootheid) ?? 0) - (grootheidVolgorde.get(b.grootheid) ?? 0));
}

/**
 * Een doorlopende staaf is een gerichte, rechte keten met dezelfde niet-lege
 * staafnaam en dezelfde lokale rolhoek. Bij een aftakking, knik of omgekeerde
 * richting voegen we niets samen: de lokale krachtcomponenten zouden dan een
 * andere betekenis krijgen. Losse segmenten blijven in de tabel per staaf.
 */
export function openFem3DDoorlopendeOmhullenden(
  model: Pick<OpenFem3DModel, "nodes" | "beams">,
  omhullenden: readonly OpenFem3DOmhullendeRij[],
): OpenFem3DDoorlopendeRij[] {
  const knopen = new Map<number, OpenFem3DNode>(model.nodes.map((k) => [k.id, k]));
  const metNaam = model.beams.filter((b) => b.name?.trim());
  const uitgaand = new Map<string, OpenFem3DBeam[]>();
  const inkomend = new Map<string, OpenFem3DBeam[]>();
  const sleutel = (naam: string, knoopId: number) => `${naam}\u0000${knoopId}`;
  for (const staaf of metNaam) {
    const naam = staaf.name!.trim();
    const a = sleutel(naam, staaf.startNodeId), b = sleutel(naam, staaf.endNodeId);
    uitgaand.set(a, [...(uitgaand.get(a) ?? []), staaf]);
    inkomend.set(b, [...(inkomend.get(b) ?? []), staaf]);
  }
  const lengte = (b: OpenFem3DBeam) => {
    const a = knopen.get(b.startNodeId), z = knopen.get(b.endNodeId);
    return a && z ? Math.hypot(z.x - a.x, z.y - a.y, z.z - a.z) : 0;
  };
  const sluitAan = (a: OpenFem3DBeam, b: OpenFem3DBeam) => {
    if (a.endNodeId !== b.startNodeId || a.name?.trim() !== b.name?.trim()) return false;
    if (Math.abs((a.rollAngleRad ?? 0) - (b.rollAngleRad ?? 0)) > 1e-8) return false;
    const ka = knopen.get(a.startNodeId), km = knopen.get(a.endNodeId), kb = knopen.get(b.endNodeId);
    if (!ka || !km || !kb) return false;
    const va = [km.x - ka.x, km.y - ka.y, km.z - ka.z];
    const vb = [kb.x - km.x, kb.y - km.y, kb.z - km.z];
    const la = Math.hypot(...va), lb = Math.hypot(...vb);
    return la > 0 && lb > 0 && va.reduce((som, x, i) => som + x * vb[i], 0) / (la * lb) > 1 - 1e-8;
  };
  const voorganger = (b: OpenFem3DBeam) => {
    const naam = b.name!.trim(), op = inkomend.get(sleutel(naam, b.startNodeId)) ?? [];
    const af = uitgaand.get(sleutel(naam, b.startNodeId)) ?? [];
    return op.length === 1 && af.length === 1 && sluitAan(op[0], b) ? op[0] : null;
  };
  const opvolger = (b: OpenFem3DBeam) => {
    const naam = b.name!.trim(), op = inkomend.get(sleutel(naam, b.endNodeId)) ?? [];
    const af = uitgaand.get(sleutel(naam, b.endNodeId)) ?? [];
    return op.length === 1 && af.length === 1 && sluitAan(b, af[0]) ? af[0] : null;
  };
  const verwerkt = new Set<number>();
  const krachtRijen = new Map(omhullenden.filter((r) => r.groep === "staaf")
    .map((r) => [`${r.soort}:${r.id}:${r.grootheid}`, r] as const));
  const uit: OpenFem3DDoorlopendeRij[] = [];
  for (const staaf of metNaam) {
    if (verwerkt.has(staaf.id)) continue;
    let eerste = staaf;
    const terug = new Set<number>([staaf.id]);
    while (true) {
      const vorige = voorganger(eerste);
      if (!vorige || terug.has(vorige.id)) break;
      terug.add(vorige.id);
      eerste = vorige;
    }
    const keten: OpenFem3DBeam[] = [];
    const gezien = new Set<number>();
    let huidig: OpenFem3DBeam | null = eerste;
    while (huidig && !gezien.has(huidig.id) && !verwerkt.has(huidig.id)) {
      keten.push(huidig);
      gezien.add(huidig.id);
      huidig = opvolger(huidig);
    }
    keten.forEach((b) => verwerkt.add(b.id));
    if (keten.length < 2 || huidig?.id === eerste.id) continue;
    const offsets = new Map<number, number>();
    let totaleLengte = 0;
    for (const b of keten) { offsets.set(b.id, totaleLengte); totaleLengte += lengte(b); }
    for (const soort of ["uls", "sls"] as const) {
      for (const [grootheid] of KRACHTEN) {
        const deelRijen = keten.flatMap((b) => {
          const r = krachtRijen.get(`${soort}:${b.id}:${grootheid}`);
          if (!r) return [];
          const offset = offsets.get(b.id)!;
          const verschuif = (p: OmhullendePunt): OmhullendePunt => ({
            ...p, ...(p.positieM === undefined ? {} : { positieM: offset + p.positieM }),
          });
          return [{ min: verschuif(r.min), max: verschuif(r.max), eenheid: r.eenheid, combinatieIds: r.combinatieIds }];
        });
        // Geen onvolledige ketenomhullende tonen als een deel geen uitkomst heeft.
        if (deelRijen.length !== keten.length) continue;
        const dekking = deelRijen[0].combinatieIds;
        if (deelRijen.some((r) => r.combinatieIds.size !== dekking.size ||
          [...dekking].some((id) => !r.combinatieIds.has(id)))) continue;
        uit.push({
          soort, naam: staaf.name!.trim(), deelIds: keten.map((b) => b.id), lengteM: totaleLengte,
          grootheid, eenheid: deelRijen[0].eenheid,
          min: deelRijen.reduce((a, b) => b.min.waarde < a.waarde ? b.min : a, deelRijen[0].min),
          max: deelRijen.reduce((a, b) => b.max.waarde > a.waarde ? b.max : a, deelRijen[0].max),
        });
      }
    }
  }
  return uit;
}

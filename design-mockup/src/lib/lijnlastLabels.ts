/**
 * Lastlabels op het 2D-tekenvlak: een reeks aansluitende staven op één lijn
 * met precies dezelfde lijnlast (bijvoorbeeld een ligger die in drie stukken
 * is geknipt) kreeg op elke staaf een eigen label "q=… kN/m". Op korte staven
 * schoven die labels over elkaar heen. Nu toont alleen de middelste staaf van
 * zo'n keten het label. De pijlen en het aanklikken blijven per staaf werken.
 *
 * Telt alleen voor een gelijkmatige last over de hele staaf zonder
 * stapelverschuiving: een deellast, een trapezium of een gestapelde band
 * houdt altijd zijn eigen label.
 */
export interface LijnlastVoorLabel {
  id: number;
  beamId: number;
  caseId: number;
  /** Gelijkmatige waarde; ontbreekt bij een trapezium. */
  q: number | undefined;
  trapezium: boolean;
  qDir: string;
  qCoord: string;
  startFrac: number;
  endFrac: number;
  /** Stapelverschuiving van de band (px); 0 = niet gestapeld. */
  stapelOffset: number;
}

export function verborgenLijnlastLabels(
  lasten: readonly LijnlastVoorLabel[],
  staven: readonly { id: number; from: number; to: number }[],
  knopen: readonly { id: number; x: number; z: number }[],
): Set<number> {
  const staaf = new Map(staven.map((s) => [s.id, s]));
  const knoop = new Map(knopen.map((k) => [k.id, k]));
  const kandidaten = lasten.filter((l) => !l.trapezium && l.q !== undefined
    && l.startFrac <= 1e-9 && l.endFrac >= 1 - 1e-9 && Math.abs(l.stapelOffset) < 1e-9
    && staaf.has(l.beamId));
  const groepen = new Map<string, LijnlastVoorLabel[]>();
  for (const l of kandidaten) {
    const sleutel = `${l.caseId}|${l.q}|${l.qDir}|${l.qCoord}`;
    groepen.set(sleutel, [...(groepen.get(sleutel) ?? []), l]);
  }
  const richting = (beamId: number) => {
    const s = staaf.get(beamId)!;
    const a = knoop.get(s.from), b = knoop.get(s.to);
    if (!a || !b) return null;
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    return L > 0 ? { ux: (b.x - a.x) / L, uz: (b.z - a.z) / L, a, b } : null;
  };
  const verborgen = new Set<number>();
  for (const groep of groepen.values()) {
    if (groep.length < 2) continue;
    // Twee lasten horen bij dezelfde keten als hun staven een knoop delen en
    // evenwijdig zijn; met een gedeelde knoop liggen ze dan op één lijn.
    const ouder = groep.map((_, i) => i);
    const wortel = (i: number): number => { while (ouder[i] !== i) i = ouder[i] = ouder[ouder[i]]; return i; };
    for (let i = 0; i < groep.length; i++) {
      const ri = richting(groep[i].beamId);
      if (!ri) continue;
      const si = staaf.get(groep[i].beamId)!;
      for (let j = i + 1; j < groep.length; j++) {
        const rj = richting(groep[j].beamId);
        if (!rj) continue;
        const sj = staaf.get(groep[j].beamId)!;
        const deelt = [si.from, si.to].some((n) => n === sj.from || n === sj.to);
        const evenwijdig = Math.abs(ri.ux * rj.uz - ri.uz * rj.ux) < 1e-6;
        if (deelt && evenwijdig) ouder[wortel(i)] = wortel(j);
      }
    }
    const ketens = new Map<number, LijnlastVoorLabel[]>();
    groep.forEach((l, i) => ketens.set(wortel(i), [...(ketens.get(wortel(i)) ?? []), l]));
    for (const keten of ketens.values()) {
      if (keten.length < 2) continue;
      // Langs de lijn ordenen op het midden van elke staaf; de middelste houdt het label.
      const r = richting(keten[0].beamId)!;
      const positie = (l: LijnlastVoorLabel) => {
        const d = richting(l.beamId)!;
        return ((d.a.x + d.b.x) / 2) * r.ux + ((d.a.z + d.b.z) / 2) * r.uz;
      };
      const geordend = [...keten].sort((p, q) => positie(p) - positie(q));
      const houd = geordend[Math.floor((geordend.length - 1) / 2)].id;
      for (const l of geordend) if (l.id !== houd) verborgen.add(l.id);
    }
  }
  return verborgen;
}

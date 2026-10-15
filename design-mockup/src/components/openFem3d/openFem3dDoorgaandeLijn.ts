/**
 * openFem3dDoorgaandeLijn.ts — een door tussenknopen geknipte 3D-staaf als ÉÉN
 * staaf toetsen, en de staafeinden benoemen die géén gaffel zijn (issue #207).
 * De 3D-tegenhanger van `lib/doorgaandeLijn.ts`.
 *
 * HET PROBLEEM
 *
 * Een kolom of ligger die op een knoop is geknipt (voor een puntlast, of
 * gewoon om te knippen) bestaat in het model uit twee staven. De 3D-toetsen
 * zagen twee losse staven: elk deel kreeg zijn eigen lengte als kniklengte en
 * als kipveld, en de tussenknoop telde als gaffel. Een kolom van 6 m, geknipt
 * op 3 m, kreeg zo L_cr = 3 m in plaats van 6 m (basisaudit: een tussenknoop
 * halveert de kniklengte), en de doorbuiging werd per deel gemeten vanaf de
 * koorde van dat deel.
 *
 * DE OPLOSSING
 *
 * Vóór de toetsing worden staven samengevoegd tot één VIRTUELE staaf als
 *  - ze in elkaars verlengde liggen (collineair, aan weerszijden van de knoop);
 *  - ze dezelfde doorsnede (prismatisch, hetzelfde profiel), hetzelfde
 *    materiaal en dezelfde stand van de doorsnede hebben (de hoofdassen
 *    evenwijdig), en allebei een gewone staaf zijn (geen trek-alleen staaf,
 *    geen bedding, dezelfde afschuifinstelling);
 *  - op de gedeelde knoop niets anders zit: geen oplegging, geen andere staaf,
 *    geen plaat en geen starre schijf (precies twee staven op de knoop);
 *  - er op die knoop geen scharnier (vrijgave) zit: een scharnier is een echte
 *    knik in de lijn, en de doorbuiging van de virtuele staaf (de kromming
 *    M/EI geïntegreerd tussen de lijneinden) kan die niet volgen.
 *
 * De virtuele staaf krijgt het laagste staafnummer van de delen; de andere
 * delen komen met reden bij de overgeslagen staven. Haar resultaten zijn de
 * aaneengeregen krachtlijnen van de delen (in de assen van de lijn: een
 * tegengesteld getekend deel wordt gespiegeld), zodat de kniklengte zonder
 * opgave, de kipvelden en de koorde van de doorbuiging over de hele lijn
 * gaan. De toetsinstellingen van de delen worden samengevoegd zoals in 2D
 * (`voegConfigSamen`): kipsteunen omgerekend naar de lijn, een opgegeven
 * kniklengte of kipsteunafstand de grootste, een klasse die van het eerste deel.
 *
 * DOORLOPEND STAAFEIND
 *
 * Loopt een (virtuele) staaf op een eind zonder oplegging, plaat of schijf
 * door in een staaf in haar verlengde die NIET is samengevoegd (een andere
 * doorsnede of stand, een ander materiaal, een verlopend profiel, een
 * scharnier, een trek-alleen staaf of bedding) en sluit er verder niets aan,
 * dan is dat eind geen gaffel maar DOORLOPEND. De staalkern weigert dan kip en,
 * zonder opgegeven kniklengtes, knik ("niet volledig getoetst"), zoals in 2D.
 * De houtkern weigert dan, zonder opgegeven kniklengtes, de kolomtoets en,
 * zonder kipsteunafstand, de kiptoets (issue #205).
 *
 * Puur: geen React, geen DOM, geen Tauri.
 */
import { voegConfigSamen } from "../../lib/doorgaandeLijn";
import type { BeamCheckConfig } from "../fem/femTypes";
import {
  openFem3DMemberAxes,
  type OpenFem3DBeam,
  type OpenFem3DMemberLoad,
  type OpenFem3DMemberPointLoad,
  type OpenFem3DModel,
} from "./openFem3dModel";
import type {
  OpenFem3DDiagramPoint,
  OpenFem3DDiagrams,
  OpenFem3DMemberDiagram,
  OpenFem3DMemberForces,
  OpenFem3DSolveResult,
} from "./openFem3dSolver";
import { openFem3DEinden } from "./openFem3dUitkraging";

type Vec3 = [number, number, number];

/** Eén deel van een doorgaande lijn, in de volgorde van begin naar eind. */
export interface OpenFem3DLijnDeel {
  beam: OpenFem3DBeam;
  /** Lengte (m) en de afstand van het lijnbegin tot het begin van dit deel (m). */
  lengteM: number;
  xStartM: number;
  /**
   * De richting van de assen van dit deel ten opzichte van die van de lijn:
   * +1 of −1 per as (x langs de lijn). −1 bij x = het deel is tegen de
   * lijnrichting in getekend.
   */
  sx: 1 | -1;
  sy: 1 | -1;
  sz: 1 | -1;
}

/** Een doorgaande lijn: twee of meer samengevoegde staven. */
export interface OpenFem3DDoorgaandeLijn {
  /** Het staafnummer waaronder de lijn wordt getoetst: het laagste van de delen. */
  id: number;
  delen: OpenFem3DLijnDeel[];
  /** De knopen tussen de delen, in volgorde. */
  tussenknopen: number[];
  startNodeId: number;
  endNodeId: number;
  lengteM: number;
}

/** De staafeinden van een (virtuele) staaf: wat de staalkern als `staafeinden` krijgt, zonder "Vrij". */
export interface OpenFem3DDoorlopendeEinden {
  begin: boolean;
  eind: boolean;
  /** Per doorlopend eind de knoop en de staaf waarin de lijn doorloopt, en waarom die niet is samengevoegd. */
  redenen: string[];
}

const nl = (v: number, d = 3): string => v.toFixed(d).replace(".", ",");
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** Twee eenheidsvectoren evenwijdig (|cos| ≥ 1 − 1e-6). */
const COS_EVENWIJDIG = 1 - 1e-6;
/** De reden van `nietSamen` voor een staaf die niet in het verlengde ligt (of zonder geometrie). */
const GEEN_VERLENGDE = "geen verlengde";

/** Het andere eind van een staaf. */
const ander = (beam: OpenFem3DBeam, knoop: number) => (beam.startNodeId === knoop ? beam.endNodeId : beam.startNodeId);

/** Een vrijgave van de staaf op deze knoop (moment of torsie)? */
function heeftVrijgave(beam: OpenFem3DBeam, knoop: number): boolean {
  const r = beam.releases;
  if (!r) return false;
  return beam.startNodeId === knoop
    ? r.myStart || r.mzStart || r.torsionStart
    : r.myEnd || r.mzEnd || r.torsionEnd;
}

/** Het profiel van een prismatische staaf, of `null` bij een verlopende. */
function prismatischProfiel(beam: OpenFem3DBeam): string | null {
  const begin = beam.profileName?.trim() ?? "";
  const eind = beam.profileNameEnd?.trim() ?? "";
  if (eind !== "" && eind !== begin) return null;
  return begin;
}

/**
 * Waarom staaf `b` op knoop `knoop` niet met `a` tot één lijn samengaat, of
 * `null` als dat wel kan. Alleen de eigenschappen van de twee staven; wat er
 * verder op de knoop zit, beslist `vindLijnen`.
 */
function nietSamen(model: Pick<OpenFem3DModel, "nodes">, a: OpenFem3DBeam, b: OpenFem3DBeam, knoop: number): string | null {
  // Eerst de meetkunde: een staaf die niet in het verlengde ligt, is een
  // aansluiting en geen voortzetting, wat de doorsnede ook is.
  const k = (id: number) => model.nodes.find((n) => n.id === id);
  const n = k(knoop), na = k(ander(a, knoop)), nb = k(ander(b, knoop));
  if (!n || !na || !nb) return GEEN_VERLENGDE;
  const richting = (p: { x: number; y: number; z: number }): Vec3 => {
    const v: Vec3 = [p.x - n.x, p.y - n.y, p.z - n.z];
    const l = Math.hypot(...v);
    return l > 0 ? [v[0] / l, v[1] / l, v[2] / l] : [0, 0, 0];
  };
  if (dot(richting(na), richting(nb)) > -COS_EVENWIJDIG) return GEEN_VERLENGDE;
  const pa = prismatischProfiel(a), pb = prismatischProfiel(b);
  if (pa === null || pb === null) return "een verlopend profiel";
  if (pa !== pb) return `een andere doorsnede (${pa || "—"} en ${pb || "—"})`;
  if ((a.material?.trim() ?? "") !== (b.material?.trim() ?? "")) return `een ander materiaal (${a.material ?? "—"} en ${b.material ?? "—"})`;
  if (a.tensionOnly || b.tensionOnly) return "een trek-alleen staaf";
  if (a.bedding || b.bedding) return "een staaf op bedding";
  if (Boolean(a.shearDeformation) !== Boolean(b.shearDeformation)) return "een andere afschuifinstelling";
  if (heeftVrijgave(a, knoop) || heeftVrijgave(b, knoop)) return "een scharnier (vrijgave) op de knoop";
  const assen = (beam: OpenFem3DBeam) => {
    const s = k(beam.startNodeId)!, e = k(beam.endNodeId)!;
    return openFem3DMemberAxes(s, e, beam.rollAngleRad ?? 0);
  };
  const aa = assen(a), ab = assen(b);
  if (Math.abs(dot(aa.ey, ab.ey)) < COS_EVENWIJDIG || Math.abs(dot(aa.ez, ab.ez)) < COS_EVENWIJDIG) {
    return "een andere stand van de doorsnede (de hoofdassen zijn niet evenwijdig)";
  }
  return null;
}

/** Wat er op een knoop zit, behalve staven. */
function knoopVast(model: OpenFem3DModel, einden: ReturnType<typeof openFem3DEinden>) {
  const opgelegd = new Set((model.supports ?? []).map((s) => s.nodeId));
  const schijf = new Set((model.diaphragms ?? []).flatMap((d) => d.nodeIds));
  return (knoop: number): string | null =>
    opgelegd.has(knoop) ? "een oplegging"
      : schijf.has(knoop) ? "een starre schijf"
        : einden.knoopInPlaat(knoop) ? "een plaat"
          : null;
}

/** Staven per knoop. */
function stavenPerKnoop(model: Pick<OpenFem3DModel, "beams">): Map<number, OpenFem3DBeam[]> {
  const uit = new Map<number, OpenFem3DBeam[]>();
  for (const beam of model.beams) {
    for (const knoop of new Set([beam.startNodeId, beam.endNodeId])) uit.set(knoop, [...(uit.get(knoop) ?? []), beam]);
  }
  return uit;
}

/**
 * De doorgaande lijnen van het model: elke keten van twee of meer staven die
 * volgens de regels hierboven samengaan. Staven die nergens mee samengaan,
 * staan er niet in.
 */
export function openFem3DDoorgaandeLijnen(model: OpenFem3DModel): OpenFem3DDoorgaandeLijn[] {
  const einden = openFem3DEinden(model);
  const vast = knoopVast(model, einden);
  const perKnoop = stavenPerKnoop(model);
  const knoopVan = new Map(model.nodes.map((n) => [n.id, n]));
  /** De knopen waarover de lijn doorloopt: precies twee staven, niets anders, en die twee gaan samen. */
  const doorgaand = new Set<number>();
  for (const [knoop, staven] of perKnoop) {
    if (staven.length !== 2 || staven[0].id === staven[1].id || vast(knoop)) continue;
    if (nietSamen(model, staven[0], staven[1], knoop) === null) doorgaand.add(knoop);
  }
  const gezien = new Set<number>();
  const lijnen: OpenFem3DDoorgaandeLijn[] = [];
  for (const beam of [...model.beams].sort((a, b) => a.id - b.id)) {
    if (gezien.has(beam.id)) continue;
    if (!doorgaand.has(beam.startNodeId) && !doorgaand.has(beam.endNodeId)) continue;
    // Loop naar één eind van de keten, dan de keten af naar het andere eind.
    let begin = beam, beginKnoop = beam.startNodeId;
    const bezocht = new Set([beam.id]);
    while (doorgaand.has(beginKnoop)) {
      const volgende = perKnoop.get(beginKnoop)!.find((b) => b.id !== begin.id)!;
      if (bezocht.has(volgende.id)) break; // een gesloten ring: begin waar we zijn
      bezocht.add(volgende.id);
      beginKnoop = ander(volgende, beginKnoop);
      begin = volgende;
    }
    // `beginKnoop` is het vrije eind van `begin`; de keten loopt van daar weg.
    const keten: { beam: OpenFem3DBeam; van: number; naar: number }[] = [];
    let huidig = begin, van = beginKnoop;
    const inKeten = new Set<number>();
    for (;;) {
      const naar = ander(huidig, van);
      keten.push({ beam: huidig, van, naar });
      inKeten.add(huidig.id);
      if (!doorgaand.has(naar)) break;
      const volgende = perKnoop.get(naar)!.find((b) => b.id !== huidig.id)!;
      if (inKeten.has(volgende.id)) break;
      huidig = volgende;
      van = naar;
    }
    for (const d of keten) gezien.add(d.beam.id);
    if (keten.length < 2) continue;
    // De lijnrichting is die van het eerste deel zoals het getekend is: draai
    // de keten om als het eerste deel tegen de keten in staat. Zo heeft de
    // virtuele staaf de assen van dat deel (en zijn rol).
    if (keten[0].beam.startNodeId !== keten[0].van) {
      keten.reverse();
      for (const d of keten) [d.van, d.naar] = [d.naar, d.van];
    }
    const p = (id: number) => knoopVan.get(id)!;
    const asVan = (b: OpenFem3DBeam) => openFem3DMemberAxes(p(b.startNodeId), p(b.endNodeId), b.rollAngleRad ?? 0);
    const lijnAssen = asVan(keten[0].beam);
    const teken = (v: number): 1 | -1 => (v < 0 ? -1 : 1);
    let x = 0;
    const delen: OpenFem3DLijnDeel[] = keten.map((d) => {
      const a = p(d.beam.startNodeId), e = p(d.beam.endNodeId);
      const lengteM = Math.hypot(e.x - a.x, e.y - a.y, e.z - a.z);
      const assen = asVan(d.beam);
      const deel: OpenFem3DLijnDeel = {
        beam: d.beam, lengteM, xStartM: x,
        sx: teken(dot(assen.ex, lijnAssen.ex)),
        sy: teken(dot(assen.ey, lijnAssen.ey)),
        sz: teken(dot(assen.ez, lijnAssen.ez)),
      };
      x += lengteM;
      return deel;
    });
    lijnen.push({
      id: Math.min(...delen.map((d) => d.beam.id)),
      delen,
      tussenknopen: keten.slice(1).map((d) => d.van),
      startNodeId: keten[0].van,
      endNodeId: keten[keten.length - 1].naar,
      lengteM: x,
    });
  }
  return lijnen;
}

/**
 * De doorlopende einden van een staaf in het (samengevoegde) model: een eind
 * zonder oplegging, schijf of plaat waar alleen staven in het verlengde
 * aansluiten. Een vrij eind (geen andere staaf) is hier niet doorlopend.
 */
export function openFem3DDoorlopendeEinden(model: OpenFem3DModel): (beam: OpenFem3DBeam) => OpenFem3DDoorlopendeEinden {
  const einden = openFem3DEinden(model);
  const vast = knoopVast(model, einden);
  const perKnoop = stavenPerKnoop(model);
  return (beam) => {
    const redenen: string[] = [];
    const eind = (knoop: number): boolean => {
      if (vast(knoop)) return false;
      const anderen = (perKnoop.get(knoop) ?? []).filter((b) => b.id !== beam.id);
      if (anderen.length === 0) return false;
      const waarom = anderen.map((b) => ({ b, reden: nietSamen(model, beam, b, knoop) }));
      if (waarom.some((w) => w.reden === GEEN_VERLENGDE)) return false;
      for (const w of waarom) {
        redenen.push(`knoop ${knoop}: de staaf loopt door in staaf ${w.b.id}` +
          (anderen.length > 1 ? " (met nog andere staven in het verlengde)" : "") +
          (w.reden ? `, met ${w.reden}` : ", die met nog een staaf samenkomt"));
      }
      return true;
    };
    return { begin: eind(beam.startNodeId), eind: eind(beam.endNodeId), redenen };
  };
}

/** Een krachtcomponent in de assen van de lijn: het teken per component. */
const COMPONENTEN: readonly {
  key: keyof OpenFem3DDiagrams;
  start: keyof OpenFem3DMemberForces;
  end: keyof OpenFem3DMemberForces;
  /** Het teken in de lijnassen: N en T blijven, V_y en M_y × s_x·s_y, V_z en M_z × s_x·s_z. */
  teken: (d: OpenFem3DLijnDeel) => number;
}[] = [
  { key: "axial", start: "nStartKn", end: "nEndKn", teken: () => 1 },
  { key: "torsion", start: "torsionStartKnm", end: "torsionEndKnm", teken: () => 1 },
  { key: "shearY", start: "vyStartKn", end: "vyEndKn", teken: (d) => d.sx * d.sy },
  { key: "momentY", start: "myStartKnm", end: "myEndKnm", teken: (d) => d.sx * d.sy },
  { key: "shearZ", start: "vzStartKn", end: "vzEndKn", teken: (d) => d.sx * d.sz },
  { key: "momentZ", start: "mzStartKnm", end: "mzEndKnm", teken: (d) => d.sx * d.sz },
];

/**
 * De krachtlijnen van een lijn in één uitkomst, aaneengeregen in de assen van
 * de lijn. Het teken volgt uit de snedekrachten op het positieve snedevlak:
 * een tegengesteld getekend deel (s_x = −1) heeft het andere snedevlak, dus de
 * krachtvector keert om; de componenten volgen dan uit de assen van het deel
 * en die van de lijn (`COMPONENTEN`). Zonder krachtlijn van de kern geldt de
 * rechte lijn tussen de eindwaarden van het deel. `null` als een deel geen
 * staafkrachten heeft.
 */
function lijnKrachten(
  lijn: OpenFem3DDoorgaandeLijn,
  result: OpenFem3DSolveResult,
): { member: OpenFem3DMemberForces; diagrammen: Partial<Record<keyof OpenFem3DDiagrams, OpenFem3DMemberDiagram>> } | null {
  const leden = lijn.delen.map((d) => result.memberForces.find((m) => m.memberId === d.beam.id));
  if (leden.some((m) => !m)) return null;
  const diagrammen: Partial<Record<keyof OpenFem3DDiagrams, OpenFem3DMemberDiagram>> = {};
  const eindwaarden = {} as Record<keyof OpenFem3DMemberForces, number>;
  for (const c of COMPONENTEN) {
    const punten: OpenFem3DDiagramPoint[] = [];
    lijn.delen.forEach((d, i) => {
      const lid = leden[i]!;
      const eigen = result.diagrams?.[c.key]?.find((diagram) => diagram.memberId === d.beam.id)?.points;
      const bron = eigen && eigen.length >= 2
        ? eigen
        : [{ t: 0, value: Number(lid[c.start]) }, { t: 1, value: Number(lid[c.end]) }];
      const teken = c.teken(d);
      const geordend = d.sx === 1 ? bron : [...bron].reverse().map((p) => ({ t: 1 - p.t, value: p.value }));
      for (const p of geordend) {
        punten.push({ t: (d.xStartM + p.t * d.lengteM) / lijn.lengteM, value: teken * p.value + 0 });
      }
    });
    const waarden = punten.map((p) => p.value);
    diagrammen[c.key] = {
      memberId: lijn.id, points: punten,
      maxValue: Math.max(...waarden), minValue: Math.min(...waarden),
      maxAbsValue: Math.max(...waarden.map(Math.abs)),
    };
    eindwaarden[c.start] = punten[0].value;
    eindwaarden[c.end] = punten[punten.length - 1].value;
  }
  return {
    member: { ...eindwaarden, memberId: lijn.id, lengthM: lijn.lengteM },
    diagrammen,
  };
}

/** Een staaflast van een deel op de virtuele staaf (positie langs de lijn). */
function lijnStaaflast(load: OpenFem3DMemberLoad, d: OpenFem3DLijnDeel, lijnId: number): OpenFem3DMemberLoad {
  const naar = (s: number) => d.xStartM + (d.sx === 1 ? s : d.lengteM - s);
  const a = naar(load.startPositionM), b = naar(load.endPositionM);
  const omgekeerd = d.sx === -1;
  if (load.globalDirection) {
    return {
      ...load, beamId: lijnId,
      startPositionM: Math.min(a, b), endPositionM: Math.max(a, b),
      ...(omgekeerd ? { qStart: load.qEnd, qEnd: load.qStart } : {}),
    };
  }
  const [qy1, qy2] = omgekeerd ? [load.qyEnd, load.qyStart] : [load.qyStart, load.qyEnd];
  const [qz1, qz2] = omgekeerd ? [load.qzEnd, load.qzStart] : [load.qzStart, load.qzEnd];
  return {
    ...load, beamId: lijnId,
    startPositionM: Math.min(a, b), endPositionM: Math.max(a, b),
    qyStart: d.sy * qy1, qyEnd: d.sy * qy2, qzStart: d.sz * qz1, qzEnd: d.sz * qz2,
  };
}

/** Een puntlast van een deel op de virtuele staaf. */
function lijnPuntlast(load: OpenFem3DMemberPointLoad, d: OpenFem3DLijnDeel, lijnId: number): OpenFem3DMemberPointLoad {
  return {
    ...load, beamId: lijnId,
    positionM: d.xStartM + (d.sx === 1 ? load.positionM : d.lengteM - load.positionM),
    py: d.sy * load.py, pz: d.sz * load.pz,
  };
}

/** De samengevoegde invoer voor een 3D-toetsbouwer. */
export interface OpenFem3DSamengevoegd {
  /** Het model met elke lijn als één virtuele staaf (en haar lasten erop). */
  model: OpenFem3DModel;
  /** Dezelfde uitkomst met de virtuele staven erin (de krachtlijnen aaneengeregen). */
  resultaat: (r: OpenFem3DSolveResult) => OpenFem3DSolveResult;
  lijnen: ReadonlyMap<number, OpenFem3DDoorgaandeLijn>;
  /** Per virtuele staaf de notities voor het rapport. */
  notities: ReadonlyMap<number, string[]>;
  /** De delen die niet apart getoetst worden, met de reden. */
  overgeslagen: { beamId: number; reason: string }[];
  /** De staaf-id's van het oorspronkelijke model die bij een virtuele staaf horen (de staaf zelf erbij). */
  ledenVan: (beamId: number) => number[];
  /** Per virtuele staaf haar delen (de staaf zelf erbij), voor de weergave. */
  lijnDelen: Record<number, number[]>;
}

/**
 * Vervang elke doorgaande lijn door haar virtuele staaf. Model en uitkomsten
 * van de aanroeper blijven onaangeroerd; een uitkomst wordt per object één
 * keer omgezet.
 */
export function openFem3DDoorgaandeLijnenSamen(model: OpenFem3DModel): OpenFem3DSamengevoegd {
  const lijnen = openFem3DDoorgaandeLijnen(model);
  if (lijnen.length === 0) {
    return {
      model, resultaat: (r) => r, lijnen: new Map(), notities: new Map(), overgeslagen: [],
      ledenVan: (id) => [id], lijnDelen: {},
    };
  }
  const deelVan = new Map<number, { lijn: OpenFem3DDoorgaandeLijn; deel: OpenFem3DLijnDeel }>();
  for (const lijn of lijnen) for (const deel of lijn.delen) deelVan.set(deel.beam.id, { lijn, deel });

  const virtueel: OpenFem3DBeam[] = [];
  const notities = new Map<number, string[]>();
  const overgeslagen: { beamId: number; reason: string }[] = [];
  for (const lijn of lijnen) {
    const eerste = lijn.delen[0], laatste = lijn.delen[lijn.delen.length - 1];
    const basis = lijn.delen.find((d) => d.beam.id === lijn.id)!.beam;
    const { config, notities: configNotities } = voegConfigSamen({
      lengteMm: lijn.lengteM * 1000,
      delen: lijn.delen.map((d) => ({
        beam: { checkConfig: d.beam.checkConfig as BeamCheckConfig | undefined },
        gespiegeld: d.sx === -1, xStartMm: d.xStartM * 1000, lengteMm: d.lengteM * 1000,
      })),
    });
    const beam: OpenFem3DBeam = {
      ...basis,
      id: lijn.id,
      startNodeId: lijn.startNodeId,
      endNodeId: lijn.endNodeId,
      rollAngleRad: eerste.beam.rollAngleRad,
    };
    delete beam.releases;
    delete beam.checkConfig;
    const beginVrij = eerste.beam.releases;
    const eindVrij = laatste.beam.releases;
    const eindVan = (r: typeof beginVrij, kant: "Start" | "End") => r
      ? { my: r[`my${kant}`], mz: r[`mz${kant}`], torsion: r[`torsion${kant}`] }
      : { my: false, mz: false, torsion: false };
    const b0 = eindVan(beginVrij, "Start");
    const b1 = eindVan(eindVrij, laatste.sx === 1 ? "End" : "Start");
    if (b0.my || b0.mz || b0.torsion || b1.my || b1.mz || b1.torsion) {
      beam.releases = {
        myStart: b0.my, mzStart: b0.mz, torsionStart: b0.torsion,
        myEnd: b1.my, mzEnd: b1.mz, torsionEnd: b1.torsion,
      };
    }
    if (config) beam.checkConfig = config;
    virtueel.push(beam);
    const ids = lijn.delen.map((d) => d.beam.id);
    for (const id of ids) {
      if (id === lijn.id) continue;
      overgeslagen.push({
        beamId: id,
        reason: `maakt deel uit van de doorgaande lijn die als staaf ${lijn.id} is getoetst ` +
          `(staven ${ids.join(", ")}, samen ${nl(lijn.lengteM)} m); zie staaf ${lijn.id}`,
      });
    }
    notities.set(lijn.id, [
      `DOORGAANDE LIJN. Deze staaf is de doorgaande lijn van de staven ${ids.join(", ")} ` +
        `(${basis.profileName ?? "—"}, ${basis.material ?? "—"}): zij liggen in elkaars verlengde, hebben ` +
        "dezelfde doorsnede, dezelfde stand en hetzelfde materiaal, en op de tussenknoop " +
        `${lijn.tussenknopen.join(", ")} staat geen oplegging en sluit geen andere staaf, plaat of schijf aan ` +
        `(en zit geen scharnier). De toetsing beschouwt de lijn als ÉÉN staaf van ${nl(lijn.lengteM)} m: de ` +
        "kniklengte zonder opgave, de kipvelden en de koorde van de doorbuiging gelden voor die hele lengte, " +
        "en een tussenknoop telt niet als steun of als gaffel. Kipsteunen van de delen zijn omgerekend naar de " +
        "lijn, en een opgegeven kniklengte, kipsteunafstand of klasse van een deel is voor de lijn overgenomen.",
      ...configNotities,
    ]);
  }

  const lijnVanId = new Map(lijnen.map((l) => [l.id, l]));
  const samengevoegd: OpenFem3DModel = {
    ...model,
    beams: model.beams.filter((b) => !deelVan.has(b.id)).concat(virtueel),
    memberLoads: (model.memberLoads ?? []).map((load) => {
      const v = deelVan.get(load.beamId);
      return v ? lijnStaaflast(load, v.deel, v.lijn.id) : load;
    }),
    memberPointLoads: (model.memberPointLoads ?? []).map((load) => {
      const v = deelVan.get(load.beamId);
      return v ? lijnPuntlast(load, v.deel, v.lijn.id) : load;
    }),
  };

  const omgezet = new WeakMap<OpenFem3DSolveResult, OpenFem3DSolveResult>();
  const resultaat = (r: OpenFem3DSolveResult): OpenFem3DSolveResult => {
    const bekend = omgezet.get(r);
    if (bekend) return bekend;
    const leden = r.memberForces.filter((m) => !deelVan.has(m.memberId));
    const diagrams = r.diagrams
      ? Object.fromEntries(Object.entries(r.diagrams).map(([k, lijst]) =>
        [k, (lijst as OpenFem3DMemberDiagram[]).filter((d) => !deelVan.has(d.memberId))])) as unknown as OpenFem3DDiagrams
      : undefined;
    for (const lijn of lijnen) {
      const k = lijnKrachten(lijn, r);
      if (!k) continue;
      leden.push(k.member);
      if (diagrams) {
        for (const [key, diagram] of Object.entries(k.diagrammen)) diagrams[key as keyof OpenFem3DDiagrams].push(diagram!);
      }
    }
    const uit: OpenFem3DSolveResult = { ...r, memberForces: leden, ...(diagrams ? { diagrams } : {}) };
    omgezet.set(r, uit);
    return uit;
  };

  return {
    model: samengevoegd,
    resultaat,
    lijnen: lijnVanId,
    notities,
    overgeslagen,
    ledenVan: (id) => lijnVanId.get(id)?.delen.map((d) => d.beam.id) ?? [id],
    lijnDelen: Object.fromEntries(lijnen.map((l) => [l.id, l.delen.map((d) => d.beam.id)])),
  };
}

/** De combinatieset met de uitkomsten van het samengevoegde model (`resultaat` per uitkomst). */
export function openFem3DSamengevoegdeSet<T extends { results: ReadonlyMap<number, OpenFem3DSolveResult> }>(
  set: T | undefined,
  samen: Pick<OpenFem3DSamengevoegd, "resultaat" | "lijnen">,
): T | undefined {
  if (!set || samen.lijnen.size === 0) return set;
  return { ...set, results: new Map([...set.results].map(([id, r]) => [id, samen.resultaat(r)])) };
}

/**
 * De overgeslagen delen van de lijnen die een bouwer heeft behandeld: is de
 * virtuele staaf getoetst, dan "deel van de doorgaande lijn"; is zij
 * overgeslagen, dan hetzelfde, met haar reden erbij. Een lijn die de bouwer
 * niet aanging (een ander materiaal) levert niets.
 */
export function openFem3DLijnDelenOvergeslagen(
  samen: Pick<OpenFem3DSamengevoegd, "overgeslagen" | "lijnen">,
  overgeslagen: readonly { beamId: number; reason: string }[],
  getoetst: readonly number[],
): { beamId: number; reason: string }[] {
  const uit: { beamId: number; reason: string }[] = [];
  for (const [id, lijn] of samen.lijnen) {
    const eigen = overgeslagen.find((s) => s.beamId === id);
    if (!eigen && !getoetst.includes(id)) continue;
    for (const deel of lijn.delen) {
      const reden = samen.overgeslagen.find((s) => s.beamId === deel.beam.id);
      if (!reden) continue;
      uit.push(eigen ? { beamId: deel.beam.id, reason: `${reden.reason}; die staaf is overgeslagen: ${eigen.reason}` } : reden);
    }
  }
  return uit;
}

/**
 * De kanttekening bij een doorlopend staafeind. Staal: de kern weigert kip en,
 * zonder opgegeven kniklengtes, knik. Hout: de houtkern weigert zonder
 * kniklengtes de kolomtoets en zonder kipsteunafstand de kiptoets (#205).
 */
export function openFem3DDoorlopendNotitie(d: OpenFem3DDoorlopendeEinden, materiaal: "staal" | "hout"): string | null {
  if (!d.begin && !d.eind) return null;
  const welk = d.begin && d.eind ? "beide einden" : d.begin ? "het begin (de startknoop)" : "het eind (de eindknoop)";
  const kop = `DOORLOPEND STAAFEIND op ${welk}: ${d.redenen.join("; ")}. Daar staat geen oplegging en sluit geen ` +
    "andere staaf, plaat of schijf aan, maar de staven zijn niet tot één lijn samengevoegd. Zo'n eind is geen gaffel.";
  return materiaal === "staal"
    ? `${kop} De kern weigert daarom de kiptoets en, zonder opgegeven kniklengtes, de kniktoets (niet volledig ` +
      "getoetst). Geef de kniklengtes en kipsteunen in de toetsinstellingen op."
    : `${kop} De houtkern weigert daarom, zonder opgegeven kniklengtes, de kolomtoets (art. 6.3.2) en, zonder ` +
      "opgegeven kipsteunafstand, de kiptoets (art. 6.3.3) (niet volledig getoetst). Geef de kniklengtes en " +
      "kipsteunen in de toetsinstellingen op.";
}

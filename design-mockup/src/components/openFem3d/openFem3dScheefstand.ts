/**
 * Initiële scheefstand in de 3D-module (NEN-EN 1993-1-1 §5.3.2).
 *
 * WAT HIER GEBEURT
 * ----------------
 * φ zelf komt uit dezelfde normfunctie als in 2D (`bepaalScheefstand` in
 * `lib/scheefstandNorm.ts`); dit bestand levert daarvoor de 3D-geometrie
 * (h en m) en zet φ om in lasten:
 *
 *  - §5.3.2(7): de scheefstand mag vervangen worden door horizontale
 *    krachten. Hier krijgt ELKE verticale last V een horizontale component
 *    φ·V op zijn eigen aangrijpingspunt: een knooplast op de knoop, een
 *    verdeelde last langs de staaf. Dat is precies de last die een over φ
 *    gekantelde constructie onder dezelfde zwaartekracht voelt, en de som
 *    over een verdieping is φ·N_Ed van die verdieping.
 *  - §5.3.2(8): de scheefstand werkt in elke horizontale richting, maar in
 *    één richting tegelijk. Een UGT-combinatie ontvouwt daarom in vier
 *    varianten: +X, −X, +Y en −Y. BGT-combinaties blijven zoals ze zijn; de
 *    scheefstand hoort bij de globale analyse voor de uiterste grenstoestand.
 *
 * De omzetting werkt op het rekenverzoek NA het samenstellen van de
 * combinatie (factoren, eigen gewicht en belastingvlakken zijn dan al
 * verwerkt), zodat elke verticale last meedoet, ook de afdracht van een
 * belastingvlak.
 *
 * Puur: geen React, geen DOM, geen Tauri.
 */
import {
  SCHEEFSTAND_COMBO_OFFSET,
  type LoadCombination,
} from "../fem/solver/combinations";
import {
  VERTICAAL_VANAF_GRADEN,
  type Kolomlijn,
  type ScheefstandGeometrie,
  type ScheefstandNorm,
} from "../../lib/scheefstandNorm";
import { vt, type VertaalbareTekst } from "../../lib/vertaalbareTekst";
import { STEEL_GRADES } from "../../lib/steelGrades";
import { openFem3DMemberAxes, type OpenFem3DModel } from "./openFem3dModel";

const S = "common:loadCases.swayDerivation.";

export type OpenFem3DScheefstandAs = "x" | "y";

/** Eén richting van de scheefstand in één berekening. */
export interface OpenFem3DScheefstand {
  /** φ in rad. */
  phi: number;
  as: OpenFem3DScheefstandAs;
  richting: 1 | -1;
}

/** Nederlandse getalweergave: komma als decimaalteken. */
function getal(x: number, decimalen: number): string {
  return x.toFixed(decimalen).replace(".", ",");
}

/**
 * h en m uit het 3D-model, met dezelfde regels als de 2D-afleiding
 * (`leidScheefstandGeometrieAf`): h van de laagste oplegging tot de hoogste
 * knoop, m = het aantal kolomlijnen. Een kolomlijn is een samenhangende keten
 * van staven die steiler staan dan 75° met het horizontale vlak; een kolom
 * die door drie verdiepingen loopt telt dus één keer. Coördinaten in m.
 */
export function leidScheefstandGeometrieAf3D(model: Pick<OpenFem3DModel, "nodes" | "beams" | "supports">): ScheefstandGeometrie {
  const afleiding: VertaalbareTekst[] = [];
  const knoop = new Map(model.nodes.map((n) => [n.id, n]));
  const alleZ = model.nodes.map((n) => n.z);
  const topZ = alleZ.length > 0 ? Math.max(...alleZ) : 0;
  const opleggingZ = (model.supports ?? [])
    .map((s) => knoop.get(s.nodeId)?.z)
    .filter((z): z is number => typeof z === "number");
  const heeftOpleggingen = opleggingZ.length > 0;
  const voetZ = heeftOpleggingen ? Math.min(...opleggingZ) : alleZ.length > 0 ? Math.min(...alleZ) : 0;
  const hoogteM = Math.max(0, topZ - voetZ);
  const voetMm = getal(voetZ * 1000, 0);
  const voet = heeftOpleggingen
    ? vt(`${S}footLowestSupport`, `laagste oplegging, z = ${voetMm} mm`, { z: voetMm })
    : vt(`${S}footLowestNode`, `geen opleggingen in het model, dus de laagste knoop, z = ${voetMm} mm`, { z: voetMm });
  afleiding.push(vt(`${S}heightDerivation`,
    `h = ${getal(hoogteM, 3)} m — van de voet (${voet.tekst}) tot de bovenkant van de constructie ` +
      `(z = ${getal(topZ * 1000, 0)} mm). ` +
      "EN 1993-1-1 figuur 5.2 meet h vanaf het opleggingsniveau; " +
      "EN 1992-1-1 §5.2(6) noemt het voor de schorende constructie de hoogte " +
      "van het gebouw.",
    { h: getal(hoogteM, 3), voet, top: getal(topZ * 1000, 0) }));

  const minSinus = Math.sin((VERTICAAL_VANAF_GRADEN * Math.PI) / 180);
  const verticaal = model.beams.filter((beam) => {
    const a = knoop.get(beam.startNodeId), b = knoop.get(beam.endNodeId);
    if (!a || !b) return false;
    const lengte = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    return lengte > 1e-9 && Math.abs(b.z - a.z) / lengte >= minSinus;
  });
  // Union-find over de knopen: verticale staven die een knoop delen vormen één kolom.
  const ouder = new Map<number, number>();
  const wortel = (x: number): number => {
    let r = x;
    while (ouder.get(r) !== r) r = ouder.get(r)!;
    let k = x;
    while (ouder.get(k) !== r) { const volgende = ouder.get(k)!; ouder.set(k, r); k = volgende; }
    return r;
  };
  for (const beam of verticaal) for (const n of [beam.startNodeId, beam.endNodeId]) if (!ouder.has(n)) ouder.set(n, n);
  for (const beam of verticaal) {
    const ra = wortel(beam.startNodeId), rb = wortel(beam.endNodeId);
    if (ra !== rb) ouder.set(ra, rb);
  }
  const perWortel = new Map<number, number[]>();
  for (const beam of verticaal) {
    const r = wortel(beam.startNodeId);
    perWortel.set(r, [...(perWortel.get(r) ?? []), beam.id]);
  }
  const lijnen: (Kolomlijn & { voetYmm: number })[] = [];
  for (const staafIds of perWortel.values()) {
    const punten = staafIds.flatMap((id) => {
      const beam = verticaal.find((v) => v.id === id)!;
      return [knoop.get(beam.startNodeId)!, knoop.get(beam.endNodeId)!];
    });
    const laagste = punten.reduce((l, p) => (p.z < l.z ? p : l), punten[0]);
    lijnen.push({
      staafIds: [...staafIds].sort((a, b) => a - b),
      voetZmm: laagste.z * 1000,
      topZmm: Math.max(...punten.map((p) => p.z)) * 1000,
      voetXmm: laagste.x * 1000,
      voetYmm: laagste.y * 1000,
    });
  }
  lijnen.sort((a, b) => a.voetXmm - b.voetXmm || a.voetYmm - b.voetYmm || a.voetZmm - b.voetZmm);
  const aantalElementen = Math.max(1, lijnen.length);
  if (lijnen.length === 0) {
    afleiding.push(vt(`${S}membersFallback`,
      "m = 1 (terugval) — dit model bevat geen enkele staaf die steiler staat " +
        `dan ${VERTICAAL_VANAF_GRADEN}° met de horizontaal, dus er is geen kolomlijn te tellen. ` +
        "m = 1 geeft α_m = 1,00: de grootste waarde die de formule kan " +
        "aannemen, en dus de veilige terugval.",
      { graden: VERTICAAL_VANAF_GRADEN }));
  } else {
    const lijst = {
      lijst: lijnen.map((k, i) => vt(`${S}columnLine3d`,
        `(${i + 1}) x = ${getal(k.voetXmm, 0)} mm, y = ${getal(k.voetYmm, 0)} mm`,
        { n: i + 1, x: getal(k.voetXmm, 0), y: getal(k.voetYmm, 0) })),
      scheiding: "; ",
    };
    afleiding.push(vt(`${S}membersDerived`,
      `m = ${aantalElementen} — ${aantalElementen} kolomlijn${aantalElementen === 1 ? "" : "en"}: ` +
        lijst.lijst.map((regel) => regel.tekst).join(lijst.scheiding) +
        `. Een staaf telt als verticaal vanaf ${VERTICAAL_VANAF_GRADEN}° met de horizontaal; ` +
        "staven die een knoop delen vormen samen één kolom, zodat een kolom " +
        "door meerdere verdiepingen éénmaal telt.",
      { count: aantalElementen, lijst, graden: VERTICAAL_VANAF_GRADEN }));
  }
  afleiding.push(vt(`${S}membersNote50Percent`,
    "LET OP bij m: EN 1993-1-1 5.3.2(3)a telt alleen kolommen mee die " +
      "minstens 50 % van de gemiddelde verticale kolomkracht dragen. Die " +
      "krachten volgen uit de berekening en de berekening heeft φ nodig, dus " +
      "dat criterium is hier niet toegepast — álle kolomlijnen tellen mee. " +
      "Een licht belaste stijl hoort er met de hand uit: kleinere m geeft " +
      "grotere α_m en dus grotere φ, de veilige kant."));
  // De richtingen (±X, ±Y) staan niet hier maar in de toelichting zelf:
  // `scheefstandToelichting(…, "3d")`, zodat ze ook bij een vaste noemer staan.
  return {
    hoogteM,
    aantalElementen,
    kolomlijnen: lijnen.map(({ voetYmm: _y, ...lijn }) => lijn),
    afleidbaar: lijnen.length > 0 && hoogteM > 0,
    afleiding: afleiding.map((a) => a.tekst),
    afleidingTeksten: afleiding,
  };
}

/** De normen die het 3D-model aandraagt, uit de materialen van de staven. */
export function toepasselijkeScheefstandNormen3D(model: Pick<OpenFem3DModel, "beams">): ScheefstandNorm[] {
  const normen = new Set<ScheefstandNorm>();
  for (const beam of model.beams) {
    const materiaal = beam.material?.trim().toUpperCase() ?? "";
    if (STEEL_GRADES.includes(materiaal)) normen.add("en1993");
    else if (/^C\d+\/\d+/.test(materiaal)) normen.add("en1992");
    else if (/^(C|D|GL|LVL)\s?\d/.test(materiaal)) normen.add("en1995");
  }
  return (["en1993", "en1992", "en1995"] as const).filter((norm) => normen.has(norm));
}

const RICHTINGEN: readonly { as: OpenFem3DScheefstandAs; richting: 1 | -1; label: string }[] = [
  { as: "x", richting: 1, label: "+X" },
  { as: "x", richting: -1, label: "−X" },
  { as: "y", richting: 1, label: "+Y" },
  { as: "y", richting: -1, label: "−Y" },
];

/** Kort label van een 3D-scheefstandrichting, voor combinatienamen. */
export function scheefstandRichtingLabel3D(as: OpenFem3DScheefstandAs, richting: 1 | -1): string {
  return RICHTINGEN.find((r) => r.as === as && r.richting === richting)!.label;
}

/**
 * Elke UGT-combinatie in vier varianten (+X, −X, +Y, −Y). De variant +X houdt
 * het id van de combinatie; de andere krijgen een veelvoud van
 * `SCHEEFSTAND_COMBO_OFFSET` erbij, net als de tegenrichting in 2D. BGT-
 * combinaties blijven ongewijzigd. Uit = de lijst zoals hij is.
 */
export function metScheefstandRichtingen3D(combinations: readonly LoadCombination[], aan: boolean): LoadCombination[] {
  if (!aan) return [...combinations];
  const uit: LoadCombination[] = [];
  for (const combinatie of combinations) {
    if (combinatie.type !== "uls" || combinatie.scheefstandRichting !== undefined) {
      uit.push(combinatie);
      continue;
    }
    RICHTINGEN.forEach(({ as, richting, label }, index) => {
      uit.push({
        ...combinatie,
        id: combinatie.id + index * SCHEEFSTAND_COMBO_OFFSET,
        name: `${combinatie.name} (scheefstand ${label})`,
        scheefstandRichting: richting,
        scheefstandAs: as,
      });
    });
  }
  return uit;
}

/** De scheefstand van een (ontvouwen) combinatie, of null zonder scheefstand. */
export function scheefstandVanCombinatie(combinatie: LoadCombination, phi: number): OpenFem3DScheefstand | null {
  if (combinatie.scheefstandRichting === undefined || !(phi > 0)) return null;
  return { phi, as: combinatie.scheefstandAs ?? "x", richting: combinatie.scheefstandRichting };
}

type Vec3 = [number, number, number];

/** Het deel van een rekenverzoek dat de omzetting nodig heeft. */
export interface OpenFem3DScheefstandVerzoek {
  nodes: readonly { id: number; x: number; y: number; z: number }[];
  members: readonly { id: number; startNodeId: number; endNodeId: number; rollAngleRad?: number }[];
  nodalLoads: readonly { id: number; nodeId: number; fx: number; fy: number; fz: number; mx: number; my: number; mz: number }[];
  memberLoads: readonly {
    id: number; memberId: number;
    qyStartKnPerM: number; qyEndKnPerM: number; qzStartKnPerM: number; qzEndKnPerM: number;
    startPositionM?: number; endPositionM?: number;
  }[];
  memberPointLoads: readonly { id: number; memberId: number; pyKn: number; pzKn: number; positionM: number }[];
  /** Vlaklasten op platen, globaal per m² (alleen bij een model met platen). */
  surfaceLoads?: readonly { id: number; plateId: number; qxKnPerM2: number; qyKnPerM2: number; qzKnPerM2: number }[];
}

/**
 * Voeg aan een rekenverzoek de horizontale vervangende lasten φ·V toe.
 *
 *  - Knooplast: F_h = −φ·F_z in de gekozen richting (F_z < 0 is omlaag).
 *  - Staaflast in lokaal y/z: de globale verticale component q_Z geeft
 *    q_h = −φ·q_Z; die wordt terug ontbonden in lokaal y, z en x. Het lokale
 *    y/z-deel gaat als extra staaflast mee; het axiale deel (x), dat het
 *    contract van de kern niet als verdeelde last kent, gaat als knooplast
 *    naar de uiteinden volgens de hefboomregel, zodat resultante én moment
 *    om elk uiteinde kloppen.
 *  - Puntlast op een staaf: net zo, met het axiale deel naar de uiteinden.
 *
 * De som van alle toegevoegde horizontale krachten is exact φ·ΣV.
 */
export function metScheefstandLasten<T extends OpenFem3DScheefstandVerzoek>(verzoek: T, scheefstand: OpenFem3DScheefstand): T {
  const { phi, as, richting } = scheefstand;
  const d: Vec3 = as === "x" ? [richting, 0, 0] : [0, richting, 0];
  const knoop = new Map(verzoek.nodes.map((n) => [n.id, n]));
  const staaf = new Map(verzoek.members.map((m) => [m.id, m]));
  const assen = new Map<number, { ex: Vec3; ey: Vec3; ez: Vec3; lengte: number }>();
  const assenVan = (memberId: number) => {
    let a = assen.get(memberId);
    if (!a) {
      const m = staaf.get(memberId);
      if (!m) throw new Error(`Scheefstand: staafbelasting op onbekende staaf ${memberId}.`);
      const s = knoop.get(m.startNodeId)!, e = knoop.get(m.endNodeId)!;
      a = { ...openFem3DMemberAxes(s, e, m.rollAngleRad ?? 0), lengte: Math.hypot(e.x - s.x, e.y - s.y, e.z - s.z) };
      assen.set(memberId, a);
    }
    return a;
  };
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const extraKnoop = new Map<number, Vec3>();
  const telOp = (nodeId: number, f: Vec3) => {
    const huidig = extraKnoop.get(nodeId) ?? [0, 0, 0];
    extraKnoop.set(nodeId, [huidig[0] + f[0], huidig[1] + f[1], huidig[2] + f[2]]);
  };
  const schaal = (v: Vec3, s: number): Vec3 => [v[0] * s, v[1] * s, v[2] * s];

  for (const last of verzoek.nodalLoads) {
    if (last.fz !== 0) telOp(last.nodeId, schaal(d, -phi * last.fz));
  }

  const extraStaaflasten: T["memberLoads"][number][] = [];
  let volgendeStaaflastId = Math.max(0, ...verzoek.memberLoads.map((l) => l.id)) + 1;
  for (const last of verzoek.memberLoads) {
    const { ex, ey, ez, lengte } = assenVan(last.memberId);
    const a = last.startPositionM ?? 0, b = last.endPositionM ?? lengte;
    // Globale verticale component aan begin en eind van het belaste deel.
    const qZ1 = last.qyStartKnPerM * ey[2] + last.qzStartKnPerM * ez[2];
    const qZ2 = last.qyEndKnPerM * ey[2] + last.qzEndKnPerM * ez[2];
    if (qZ1 === 0 && qZ2 === 0) continue;
    const h1 = schaal(d, -phi * qZ1), h2 = schaal(d, -phi * qZ2);
    const qy1 = dot(h1, ey), qy2 = dot(h2, ey), qz1 = dot(h1, ez), qz2 = dot(h2, ez);
    if (qy1 !== 0 || qy2 !== 0 || qz1 !== 0 || qz2 !== 0) {
      extraStaaflasten.push({
        ...last, id: volgendeStaaflastId++,
        qyStartKnPerM: qy1, qyEndKnPerM: qy2, qzStartKnPerM: qz1, qzEndKnPerM: qz2,
      });
    }
    // Axiaal deel: trapezium van qx1 naar qx2 over [a, b], als twee knoopkrachten.
    const qx1 = dot(h1, ex), qx2 = dot(h2, ex);
    const resultante = (qx1 + qx2) / 2 * (b - a);
    if (resultante !== 0 && lengte > 0) {
      // Zwaartepunt van het trapezium, gemeten vanaf a.
      const som = qx1 + qx2;
      const xc = som !== 0 ? (b - a) * (qx1 + 2 * qx2) / (3 * som) : (b - a) / 2;
      const positie = a + xc;
      const m = staaf.get(last.memberId)!;
      telOp(m.startNodeId, schaal(ex, resultante * (1 - positie / lengte)));
      telOp(m.endNodeId, schaal(ex, resultante * (positie / lengte)));
    }
  }

  const extraPuntlasten: T["memberPointLoads"][number][] = [];
  let volgendePuntlastId = Math.max(0, ...verzoek.memberPointLoads.map((l) => l.id)) + 1;
  for (const last of verzoek.memberPointLoads) {
    const { ex, ey, ez, lengte } = assenVan(last.memberId);
    const pZ = last.pyKn * ey[2] + last.pzKn * ez[2];
    if (pZ === 0) continue;
    const h = schaal(d, -phi * pZ);
    const py = dot(h, ey), pz = dot(h, ez), px = dot(h, ex);
    if (py !== 0 || pz !== 0) extraPuntlasten.push({ ...last, id: volgendePuntlastId++, pyKn: py, pzKn: pz });
    if (px !== 0 && lengte > 0) {
      const m = staaf.get(last.memberId)!;
      telOp(m.startNodeId, schaal(ex, px * (1 - last.positionM / lengte)));
      telOp(m.endNodeId, schaal(ex, px * (last.positionM / lengte)));
    }
  }

  let volgendeKnooplastId = Math.max(0, ...verzoek.nodalLoads.map((l) => l.id)) + 1;
  const extraKnooplasten = [...extraKnoop.entries()]
    .filter(([, f]) => f.some((c) => Math.abs(c) > 0))
    .map(([nodeId, f]) => ({ id: volgendeKnooplastId++, nodeId, fx: f[0], fy: f[1], fz: f[2], mx: 0, my: 0, mz: 0 }));

  // Vlaklast op een plaat (globaal per m²): de horizontale component φ·q_Z per m².
  const surfaceLoads = verzoek.surfaceLoads?.map((last) => last.qzKnPerM2 === 0 ? last : {
    ...last,
    qxKnPerM2: last.qxKnPerM2 - phi * last.qzKnPerM2 * d[0],
    qyKnPerM2: last.qyKnPerM2 - phi * last.qzKnPerM2 * d[1],
  });

  return {
    ...verzoek,
    nodalLoads: [...verzoek.nodalLoads, ...extraKnooplasten],
    memberLoads: [...verzoek.memberLoads, ...extraStaaflasten],
    memberPointLoads: [...verzoek.memberPointLoads, ...extraPuntlasten],
    ...(surfaceLoads ? { surfaceLoads } : {}),
  };
}

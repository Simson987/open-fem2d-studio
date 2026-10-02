/**
 * openFem3dRapportBeeld.ts — een view van de 3D-werkruimte als vectorbeeld
 * voor het berekeningsrapport. Geen WebGL en geen React: dezelfde lagen als de
 * werkruimte (staven, platen, opleggingen, lasten, vervorming,
 * snedekrachtlijnen, reacties, unity checks, profielkleuren), orthografisch
 * geprojecteerd langs de kijkrichting van de view. Deterministisch, dus goed
 * af te drukken en na te rekenen in een test.
 *
 * Kijkrichting en "omhoog" zijn die van de werkruimte (openFem3DAanzichtRichting):
 * iso (1,4; −1,4; 1), boven (0; 0; 1), voor (0; −1; 0), zij (1; 0; 0), Z
 * omhoog (boven: Y); een eigen view gebruikt zijn opgeslagen camera. Schaal
 * van de vervorming en hoogte van de snedekrachtlijnen zoals in de werkruimte.
 */
import { openFem3DLoadCaseId, openFem3DMemberAxes, type OpenFem3DModel, type OpenFem3DNode } from "./openFem3dModel";
import type { OpenFem3DDiagramPoint, OpenFem3DDiagrams, OpenFem3DMemberForces, OpenFem3DSolveResult } from "./openFem3dSolver";
import type { OpenFem3DVisibility } from "./openFem3dVisibility";
import type { OpenFem3DCameraState } from "./openFem3dViewSets";
import type { OpenFem3DView } from "./openFem3dCommands";
import { openFem3DAanzichtRichting } from "./openFem3dViewCube";
import { OPEN_FEM_3D_UTILIZATION_COLORS, openFem3DUtilizationClass, type OpenFem3DUtilization } from "./openFem3dUtilization";
import { openFem3DMaximumDisplacementM, openFem3DMemberDisplacementStations } from "./openFem3dDisplacement";
import { openFem3DProfielKleuring } from "../../lib/profielKleur";

type V3 = [number, number, number];
type P2 = { x: number; y: number };

export const RAPPORT_BEELD_BREEDTE = 560;
export const RAPPORT_BEELD_HOOGTE = 300;
const MARGE = 36;

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => { const l = Math.hypot(...a); return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0]; };
const punt = (n: Pick<OpenFem3DNode, "x" | "y" | "z">): V3 => [n.x, n.y, n.z];
const hex = (kleur: number) => `#${kleur.toString(16).padStart(6, "0")}`;

/** Getal zoals in de rest van het rapport (nl-NL), met hoogstens `cijfers` decimalen. */
export const rapportGetal = (v: number, cijfers = 2) =>
  (Math.abs(v) < 5e-10 ? 0 : v).toLocaleString("nl-NL", { maximumFractionDigits: cijfers, minimumFractionDigits: 0 });

/**
 * De schermassen van een view: `rechts` en `boven` als eenheidsvectoren in
 * wereldcoördinaten (orthografisch, kijkend van de camera naar het doel).
 */
export function openFem3DKijkAssen(view: OpenFem3DView, camera: OpenFem3DCameraState | null): { rechts: V3; boven: V3 } {
  let richting: V3, omhoog: V3;
  if (camera) {
    richting = norm([camera.position[0] - camera.target[0], camera.position[1] - camera.target[1], camera.position[2] - camera.target[2]]);
    omhoog = norm(camera.up);
  } else {
    // Dezelfde richting en up als het lint en de view cube (één iso-constante).
    const aanzicht = openFem3DAanzichtRichting(view);
    richting = [...aanzicht.richting];
    omhoog = [...aanzicht.up];
  }
  let rechts = norm(cross(omhoog, richting));
  if (Math.hypot(...rechts) < 0.5) rechts = norm(cross(Math.abs(richting[2]) > 0.9 ? [0, 1, 0] : [0, 0, 1], richting));
  const boven = norm(cross(richting, rechts));
  return { rechts, boven };
}

export interface RapportLijn { x1: number; y1: number; x2: number; y2: number; kleur: string }
export interface RapportPijl extends RapportLijn { label?: string }
export interface RapportTekst { x: number; y: number; tekst: string; kleur: string }

export interface RapportBeeld {
  breedte: number;
  hoogte: number;
  platen: { punten: string }[];
  staven: (RapportLijn & { id: number })[];
  /** Vervormde staven (polylijnen). */
  vervorming: string[];
  diagrammen: { kleur: string; vlak: string; lijn: string; nullijn: RapportLijn }[];
  lastpijlen: RapportPijl[];
  lijnlasten: { punten: string; kleur: string }[];
  reacties: RapportPijl[];
  opleggingen: P2[];
  knopen: (P2 & { id: number })[];
  teksten: RapportTekst[];
  /** Vergrotingsfactor van de getekende vervorming, of null. */
  vergroting: number | null;
  /** Kleuren die een legenda nodig hebben: profielen of UC-klassen. */
  legenda: { kleur: string; tekst: string }[];
}

const DIAGRAM: Record<"shearY" | "shearZ" | "momentY" | "momentZ", {
  symbool: string; eenheid: string; kleur: string; sleutel: keyof OpenFem3DDiagrams; as: "ey" | "ez";
  eind: (f: OpenFem3DMemberForces) => [number, number];
}> = {
  shearY: { symbool: "Vy", eenheid: "kN", kleur: "#0284c7", sleutel: "shearY", as: "ey", eind: (f) => [f.vyStartKn, f.vyEndKn] },
  shearZ: { symbool: "Vz", eenheid: "kN", kleur: "#7c3aed", sleutel: "shearZ", as: "ez", eind: (f) => [f.vzStartKn, f.vzEndKn] },
  momentY: { symbool: "My", eenheid: "kNm", kleur: "#dc2626", sleutel: "momentY", as: "ez", eind: (f) => [f.myStartKnm, f.myEndKnm] },
  momentZ: { symbool: "Mz", eenheid: "kNm", kleur: "#d97706", sleutel: "momentZ", as: "ey", eind: (f) => [f.mzStartKnm, f.mzEndKnm] },
};

function materiaalKleur(materiaal: string | undefined): string {
  if (/^C\d/i.test(materiaal ?? "")) return "#64748b";
  if (/^S\d/i.test(materiaal ?? "")) return "#2563eb";
  return "#7c3f00";
}

export interface RapportBeeldInvoer {
  model: OpenFem3DModel;
  lagen: OpenFem3DVisibility;
  view: OpenFem3DView;
  camera: OpenFem3DCameraState | null;
  resultaat: OpenFem3DSolveResult | null;
  utilizations: readonly OpenFem3DUtilization[];
  loadCaseId: number;
  breedte?: number;
  hoogte?: number;
}

/** Letterbreedte (px) waarmee een label bij het passend maken meetelt. */
const LETTER_PX = 5.6;
const REGEL_PX = 11;

/**
 * Het vectorbeeld van één view. Drie stappen: eerst alles in wereldpunten
 * (met pijlen en teksten als vaste pixelafstand tot hun ankerpunt), dan de
 * schaal waarbij ook die pijlen en teksten binnen het beeld vallen, dan de
 * schermcoördinaten.
 */
export function openFem3DRapportBeeld(invoer: RapportBeeldInvoer): RapportBeeld {
  const { model, lagen, resultaat } = invoer;
  const breedte = invoer.breedte ?? RAPPORT_BEELD_BREEDTE;
  const hoogte = invoer.hoogte ?? RAPPORT_BEELD_HOOGTE;
  const { rechts, boven } = openFem3DKijkAssen(invoer.view, invoer.camera);
  const proj = (p: V3): P2 => ({ x: dot(p, rechts), y: dot(p, boven) });
  const knoop = new Map(model.nodes.map((n) => [n.id, n]));
  /** Schermrichting (y omlaag) van een wereldvector, of null als hij in de kijkrichting ligt. */
  const schermRichting = (v: V3): P2 | null => {
    const q = { x: dot(v, rechts), y: -dot(v, boven) };
    const l = Math.hypot(q.x, q.y), l3 = Math.hypot(...v);
    return l3 > 1e-12 && l / l3 > 0.15 ? { x: q.x / l, y: q.y / l } : null;
  };

  // ── Stap 1: wereldpunten, pijlen en teksten ─────────────────────────────
  let lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const n of model.nodes) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], punt(n)[i]); hi[i] = Math.max(hi[i], punt(n)[i]); }
  if (model.nodes.length === 0) { lo = [0, 0, 0]; hi = [0, 0, 0]; }
  const modelMaat = Math.max(Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]), 1);

  /** Alles wat binnen het beeld moet vallen: wereldpunt plus vaste pixelafstand. */
  const omvang: { p: V3; dx: number; dy: number }[] = [];
  const neem = (p: V3, dx = 0, dy = 0) => { omvang.push({ p, dx, dy }); };
  type TekstSpec = { p: V3; dx: number; dy: number; tekst: string; kleur: string };
  const teksten: TekstSpec[] = [];
  const tekst = (p: V3, dx: number, dy: number, inhoud: string, kleur: string) => {
    teksten.push({ p, dx, dy, tekst: inhoud, kleur });
    neem(p, dx, dy - REGEL_PX);
    neem(p, dx + inhoud.length * LETTER_PX, dy + 2);
  };
  type PijlSpec = { p: V3; richting: P2; lengte: number; kleur: string; label?: string };
  const pijlen: PijlSpec[] = [], reacties: PijlSpec[] = [];
  const pijl = (lijst: PijlSpec[], p: V3, richting: P2, lengte: number, kleur: string, label?: string) => {
    const spec: PijlSpec = { p, richting, lengte, kleur, label };
    lijst.push(spec);
    neem(p);
    const tx = -richting.x * lengte, ty = -richting.y * lengte;
    neem(p, tx, ty);
    if (label) { neem(p, tx + 4, ty - 4 - REGEL_PX); neem(p, tx + 4 + label.length * LETTER_PX, ty); }
    return spec;
  };

  const staafPunten = new Map<number, { a: V3; b: V3 }>();
  for (const s of model.beams) {
    const a = knoop.get(s.startNodeId), b = knoop.get(s.endNodeId);
    if (!a || !b) continue;
    staafPunten.set(s.id, { a: punt(a), b: punt(b) });
    neem(punt(a)); neem(punt(b));
  }
  const midden = (p: { a: V3; b: V3 }): V3 => [(p.a[0] + p.b[0]) / 2, (p.a[1] + p.b[1]) / 2, (p.a[2] + p.b[2]) / 2];
  const toonPlaten = lagen.plates && (model.plates?.length ?? 0) > 0;
  const plaatPunten: V3[][] = [];
  if (toonPlaten) {
    for (const p of model.plates ?? []) {
      const ns = p.nodeIds.map((id) => knoop.get(id)).filter((n): n is OpenFem3DNode => Boolean(n)).map(punt);
      if (ns.length >= 3) { plaatPunten.push(ns); ns.forEach((q) => neem(q)); }
    }
  }
  if (lagen.nodes) {
    const metLabel = lagen.nodeNumbers && model.nodes.length <= 80;
    for (const n of model.nodes) {
      neem(punt(n));
      if (metLabel) tekst(punt(n), 6, 15, `K${n.id}`, "#475569");
    }
  }

  // Vervorming, zoals de werkruimte: 12 % van de modelmaat.
  let vergroting: number | null = null;
  const vervormd: V3[][] = [];
  if (resultaat && lagen.deformation && lagen.beams) {
    const umax = openFem3DMaximumDisplacementM(model, resultaat);
    const f = umax > 1e-15 ? Math.min(10_000, modelMaat * 0.12 / umax) : 1;
    vergroting = f;
    for (const s of model.beams) {
      const p = staafPunten.get(s.id);
      if (!p) continue;
      const lijn = openFem3DMemberDisplacementStations(model, s, resultaat).map((st): V3 => [
        p.a[0] + (p.b[0] - p.a[0]) * st.t + f * st.ux,
        p.a[1] + (p.b[1] - p.a[1]) * st.t + f * st.uy,
        p.a[2] + (p.b[2] - p.a[2]) * st.t + f * st.uz,
      ]);
      if (lijn.length >= 2) { vervormd.push(lijn); lijn.forEach((q) => neem(q)); }
    }
  }

  // Snedekrachtlijnen: hoogte en richting zoals de werkruimte.
  const labelStap = model.beams.length <= 24 ? 1 : Math.ceil(model.beams.length / 16);
  const lijnen3: { kleur: string; basis: V3[]; top: V3[] }[] = [];
  if (resultaat && lagen.beams) {
    const perStaaf = new Map(resultaat.memberForces.map((f) => [f.memberId, f]));
    const hoogteLijn = Math.max(0.35, Math.min(3, modelMaat * 0.085));
    for (const comp of Object.keys(DIAGRAM) as (keyof typeof DIAGRAM)[]) {
      if (!lagen[comp]) continue;
      const stijl = DIAGRAM[comp];
      const monsters = (f: OpenFem3DMemberForces): OpenFem3DDiagramPoint[] => {
        const berekend = resultaat.diagrams?.[stijl.sleutel].find((d) => d.memberId === f.memberId)?.points;
        if (berekend && berekend.length >= 2) return berekend;
        const [v0, v1] = stijl.eind(f);
        return [{ t: 0, value: v0 }, { t: 1, value: v1 }];
      };
      const maximum = resultaat.memberForces.reduce((m, f) => Math.max(m, ...monsters(f).map((q) => Math.abs(q.value))), 0);
      if (!(maximum > 1e-12)) continue;
      model.beams.forEach((s, index) => {
        const f = perStaaf.get(s.id), p = staafPunten.get(s.id);
        if (!f || !p) return;
        const m = monsters(f);
        if (m.every((q) => Math.abs(q.value) < 5e-4)) return;
        const richting = openFem3DMemberAxes({ x: p.a[0], y: p.a[1], z: p.a[2] }, { x: p.b[0], y: p.b[1], z: p.b[2] }, s.rollAngleRad ?? 0)[stijl.as];
        const schaal = hoogteLijn / maximum;
        const basis: V3[] = [], top: V3[] = [];
        let piek = 0;
        m.forEach((q, i) => {
          const t = Math.min(1, Math.max(0, q.t));
          const b: V3 = [p.a[0] + (p.b[0] - p.a[0]) * t, p.a[1] + (p.b[1] - p.a[1]) * t, p.a[2] + (p.b[2] - p.a[2]) * t];
          basis.push(b);
          top.push([b[0] + richting[0] * q.value * schaal, b[1] + richting[1] * q.value * schaal, b[2] + richting[2] * q.value * schaal]);
          if (Math.abs(q.value) > Math.abs(m[piek].value)) piek = i;
        });
        top.forEach((q) => neem(q));
        lijnen3.push({ kleur: stijl.kleur, basis, top });
        if (index % labelStap === 0) tekst(top[piek], 4, -4, `${stijl.symbool} ${rapportGetal(m[piek].value)} ${stijl.eenheid}`, stijl.kleur);
      });
    }
    // Normaalkracht en torsie: als waarde op het staafmidden, zoals de werkruimte.
    if (lagen.axialForce || lagen.torsion) {
      model.beams.forEach((s, index) => {
        const f = perStaaf.get(s.id), p = staafPunten.get(s.id);
        if (!f || !p || index % labelStap !== 0) return;
        const max = (a: number, b: number) => (Math.abs(a) >= Math.abs(b) ? a : b);
        const delen = [
          lagen.axialForce ? `N ${rapportGetal(max(f.nStartKn, f.nEndKn))} kN` : "",
          lagen.torsion ? `T ${rapportGetal(max(f.torsionStartKnm, f.torsionEndKnm))} kNm` : "",
        ].filter(Boolean);
        tekst(midden(p), 5, 14, delen.join(" · "), "#92400e");
      });
    }
  }

  // Staven: UC-kleur, anders profielkleur, anders materiaalkleur.
  const uc = lagen.utilization ? new Map(invoer.utilizations.map((u) => [u.beamId, u])) : new Map<number, OpenFem3DUtilization>();
  const ucActief = uc.size > 0;
  const profielen = lagen.profileColors && !ucActief ? openFem3DProfielKleuring(model.beams) : null;
  const staafKleur = new Map<number, string>();
  if (lagen.beams) {
    model.beams.forEach((s, index) => {
      const p = staafPunten.get(s.id);
      if (!p) return;
      const u = uc.get(s.id);
      const kleur = u ? hex(OPEN_FEM_3D_UTILIZATION_COLORS[openFem3DUtilizationClass(u)])
        : profielen?.perStaaf.get(s.id)?.kleur3d ?? materiaalKleur(s.material);
      staafKleur.set(s.id, kleur);
      if (u && index % labelStap === 0) tekst(midden(p), 5, -5, u.status === "NotApplicable" ? `${u.standard} n.v.t.` : `UC ${rapportGetal(u.uc)}`, kleur);
      if (lagen.beamNumbers && index % labelStap === 0) tekst(midden(p), 5, 12, `(${s.id})`, "#1d4ed8");
    });
  }

  // Lasten van het belastinggeval.
  const lijnlasten: PijlSpec[][] = [];
  if (lagen.loads) {
    const ROOD = "#dc2626";
    const inGeval = <T extends { caseId?: number }>(l: T) => openFem3DLoadCaseId(l) === invoer.loadCaseId;
    for (const l of (model.loads ?? []).filter(inGeval)) {
      const n = knoop.get(l.nodeId);
      if (!n) continue;
      const delen = ([["Fx", l.fx, "kN"], ["Fy", l.fy, "kN"], ["Fz", l.fz, "kN"], ["Mx", l.mx, "kNm"], ["My", l.my, "kNm"], ["Mz", l.mz, "kNm"]] as const)
        .filter(([, v]) => Math.abs(v) > 1e-9).map(([s, v, e]) => `${s} ${rapportGetal(v)} ${e}`);
      const richting = schermRichting([l.fx, l.fy, l.fz]);
      if (richting) pijl(pijlen, punt(n), richting, 34, ROOD, delen.join(" · "));
      else if (delen.length > 0) tekst(punt(n), 6, -8, delen.join(" · "), ROOD);
    }
    const staaf = new Map(model.beams.map((s) => [s.id, s]));
    const lijnLasten = (model.memberLoads ?? []).filter(inGeval);
    const qmax = lijnLasten.reduce((m, l) => Math.max(m, Math.abs(l.qyStart), Math.abs(l.qyEnd), Math.abs(l.qzStart), Math.abs(l.qzEnd)), 0);
    for (const l of lijnLasten) {
      const s = staaf.get(l.beamId), p = s ? staafPunten.get(s.id) : undefined;
      if (!s || !p || !(qmax > 0)) continue;
      const lengte = Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1], p.b[2] - p.a[2]);
      const bereik = l.endPositionM - l.startPositionM;
      if (!(lengte > 0) || !(bereik > 0)) continue;
      const assen = openFem3DMemberAxes({ x: p.a[0], y: p.a[1], z: p.a[2] }, { x: p.b[0], y: p.b[1], z: p.b[2] }, s.rollAngleRad ?? 0);
      const reeks: PijlSpec[] = [];
      for (let i = 0; i < 5; i++) {
        const t = i / 4;
        const qy = l.qyStart + (l.qyEnd - l.qyStart) * t, qz = l.qzStart + (l.qzEnd - l.qzStart) * t;
        const v: V3 = [assen.ey[0] * qy + assen.ez[0] * qz, assen.ey[1] * qy + assen.ez[1] * qz, assen.ey[2] * qy + assen.ez[2] * qz];
        const x = (l.startPositionM + bereik * t) / lengte;
        const richting = schermRichting(v);
        if (richting) {
          reeks.push(pijl(pijlen, [p.a[0] + (p.b[0] - p.a[0]) * x, p.a[1] + (p.b[1] - p.a[1]) * x, p.a[2] + (p.b[2] - p.a[2]) * x],
            richting, 10 + 18 * Math.hypot(qy, qz) / qmax, ROOD));
        }
      }
      if (reeks.length >= 2) {
        lijnlasten.push(reeks);
        const q0 = Math.hypot(l.qyStart, l.qzStart), q1 = Math.hypot(l.qyEnd, l.qzEnd);
        const m = reeks[Math.floor(reeks.length / 2)];
        tekst(m.p, -m.richting.x * m.lengte + 4, -m.richting.y * m.lengte - 5,
          Math.abs(q0 - q1) < 1e-9 ? `q ${rapportGetal(q0)} kN/m` : `q ${rapportGetal(q0)}…${rapportGetal(q1)} kN/m`, ROOD);
      }
    }
    for (const l of (model.memberPointLoads ?? []).filter(inGeval)) {
      const s = staaf.get(l.beamId), p = s ? staafPunten.get(s.id) : undefined;
      if (!s || !p) continue;
      const lengte = Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1], p.b[2] - p.a[2]);
      if (!(lengte > 0)) continue;
      const assen = openFem3DMemberAxes({ x: p.a[0], y: p.a[1], z: p.a[2] }, { x: p.b[0], y: p.b[1], z: p.b[2] }, s.rollAngleRad ?? 0);
      const v: V3 = [assen.ey[0] * l.py + assen.ez[0] * l.pz, assen.ey[1] * l.py + assen.ez[1] * l.pz, assen.ey[2] * l.py + assen.ez[2] * l.pz];
      const x = Math.min(1, Math.max(0, l.positionM / lengte));
      const richting = schermRichting(v);
      if (richting) {
        pijl(pijlen, [p.a[0] + (p.b[0] - p.a[0]) * x, p.a[1] + (p.b[1] - p.a[1]) * x, p.a[2] + (p.b[2] - p.a[2]) * x],
          richting, 30, ROOD, `P ${rapportGetal(Math.hypot(l.py, l.pz))} kN`);
      }
    }
    for (const l of (model.thermalLoads ?? []).filter(inGeval)) {
      const p = staafPunten.get(l.beamId);
      if (p) tekst(midden(p), 5, -6, `ΔT ${rapportGetal(l.deltaTUniformK)} K`, "#ea580c");
    }
    for (const l of (model.surfaceLoads ?? []).filter(inGeval)) {
      const plaat = (model.plates ?? []).find((p) => p.id === l.plateId);
      const ns = plaat?.nodeIds.map((id) => knoop.get(id)).filter((n): n is OpenFem3DNode => Boolean(n)) ?? [];
      if (ns.length === 0) continue;
      const c = [0, 1, 2].map((i) => ns.reduce((som, n) => som + punt(n)[i], 0) / ns.length) as V3;
      tekst(c, 0, 0, `q ${rapportGetal(Math.hypot(l.qx, l.qy, l.qz))} kN/m²`, ROOD);
    }
  }

  // Reacties: groene pijl naar de oplegging, zoals de werkruimte.
  if (resultaat && lagen.reactions) {
    const rmax = resultaat.reactions.reduce((m, r) => Math.max(m, Math.hypot(r.fx, r.fy, r.fz)), 0);
    for (const r of resultaat.reactions) {
      const n = knoop.get(r.nodeId);
      if (!n) continue;
      const delen = ([["Rx", r.fx, "kN"], ["Ry", r.fy, "kN"], ["Rz", r.fz, "kN"], ["Mx", r.mx, "kNm"], ["My", r.my, "kNm"], ["Mz", r.mz, "kNm"]] as const)
        .filter(([, v]) => Math.abs(v) >= 5e-3).map(([s, v, e]) => `${s} ${rapportGetal(v)} ${e}`);
      if (delen.length === 0) continue;
      const kracht = Math.hypot(r.fx, r.fy, r.fz);
      const richting = rmax > 0 && kracht > 1e-9 ? schermRichting([r.fx, r.fy, r.fz]) : null;
      if (richting) pijl(reacties, punt(n), richting, 18 + 26 * kracht / rmax, "#16a34a", delen.join(" · "));
      else tekst(punt(n), 6, 26, delen.join(" · "), "#15803d");
    }
  }
  if (lagen.supports) {
    for (const s of model.supports ?? []) { const n = knoop.get(s.nodeId); if (n) { neem(punt(n), -9, 0); neem(punt(n), 9, 18); } }
  }

  // ── Stap 2: de schaal waarbij ook pijlen en teksten binnen het beeld vallen ──
  const wp = omvang.map((o) => ({ ...proj(o.p), dx: o.dx, dy: o.dy }));
  if (wp.length === 0) wp.push({ x: 0, y: 0, dx: 0, dy: 0 });
  const span = (v: number[]) => Math.max(...v) - Math.min(...v);
  const spanX = Math.max(span(wp.map((q) => q.x)), 1e-6), spanY = Math.max(span(wp.map((q) => q.y)), 1e-6);
  const extraX = Math.max(0, ...wp.map((q) => q.dx)) - Math.min(0, ...wp.map((q) => q.dx));
  const extraY = Math.max(0, ...wp.map((q) => q.dy)) - Math.min(0, ...wp.map((q) => q.dy));
  const ruimte = (maat: number, extra: number) => Math.max(maat * 0.35, maat - 2 * MARGE - extra);
  const schaal = Math.min(ruimte(breedte, extraX) / spanX, ruimte(hoogte, extraY) / spanY);
  const sx = wp.map((q) => q.x * schaal + q.dx), sy = wp.map((q) => -q.y * schaal + q.dy);
  const dx = (breedte - span(sx)) / 2 - Math.min(...sx);
  const dy = (hoogte - span(sy)) / 2 - Math.min(...sy);

  // ── Stap 3: schermcoördinaten ────────────────────────────────────────────
  const scherm = (p: V3): P2 => { const q = proj(p); return { x: dx + q.x * schaal, y: dy - q.y * schaal }; };
  const pnt = (q: P2) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`;
  const naarPijl = (s: PijlSpec): RapportPijl => {
    const kop = scherm(s.p);
    return { x1: kop.x - s.richting.x * s.lengte, y1: kop.y - s.richting.y * s.lengte, x2: kop.x, y2: kop.y, kleur: s.kleur, ...(s.label ? { label: s.label } : {}) };
  };
  const beeld: RapportBeeld = {
    breedte, hoogte,
    platen: plaatPunten.map((ns) => ({ punten: ns.map((q) => pnt(scherm(q))).join(" ") })),
    staven: [],
    vervorming: vervormd.map((lijn) => lijn.map((q) => pnt(scherm(q))).join(" ")),
    diagrammen: lijnen3.map((l) => {
      const basis = l.basis.map(scherm), top = l.top.map(scherm);
      const a = basis[0], b = basis[basis.length - 1];
      return {
        kleur: l.kleur, vlak: [...basis, ...[...top].reverse()].map(pnt).join(" "), lijn: top.map(pnt).join(" "),
        nullijn: { x1: a.x, y1: a.y, x2: b.x, y2: b.y, kleur: l.kleur },
      };
    }),
    lastpijlen: pijlen.map(naarPijl),
    lijnlasten: lijnlasten.map((reeks) => ({
      punten: reeks.map((s) => { const q = naarPijl(s); return `${q.x1.toFixed(1)},${q.y1.toFixed(1)}`; }).join(" "), kleur: "#dc2626",
    })),
    reacties: reacties.map(naarPijl),
    opleggingen: lagen.supports ? (model.supports ?? []).flatMap((s) => { const n = knoop.get(s.nodeId); return n ? [scherm(punt(n))] : []; }) : [],
    knopen: lagen.nodes ? model.nodes.map((n) => ({ id: n.id, ...scherm(punt(n)) })) : [],
    teksten: teksten.map((t) => { const q = scherm(t.p); return { x: q.x + t.dx, y: q.y + t.dy, tekst: t.tekst, kleur: t.kleur }; }),
    vergroting,
    legenda: [],
  };
  if (lagen.beams) {
    for (const s of model.beams) {
      const p = staafPunten.get(s.id);
      if (!p) continue;
      const a = scherm(p.a), b = scherm(p.b);
      beeld.staven.push({ id: s.id, x1: a.x, y1: a.y, x2: b.x, y2: b.y, kleur: staafKleur.get(s.id) ?? materiaalKleur(s.material) });
    }
    if (ucActief) {
      beeld.legenda = [["low", "≤ 0,50"], ["medium", "0,50–0,80"], ["high", "0,80–1,00"], ["fail", "> 1,00"]]
        .map(([k, t]) => ({ kleur: hex(OPEN_FEM_3D_UTILIZATION_COLORS[k as keyof typeof OPEN_FEM_3D_UTILIZATION_COLORS]), tekst: `UC ${t}` }));
    } else if (profielen) {
      beeld.legenda = profielen.regels.filter((r) => !r.zonderProfiel).map((r) => ({ kleur: r.kleur3d, tekst: r.naam }));
    }
  }
  return beeld;
}

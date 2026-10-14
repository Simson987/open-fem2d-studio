/**
 * Trek-alleen staven en starre schijven in het 3D-model, en wat de
 * rekenuitkomst daarover zegt.
 *
 * Modelbewerkingen: een staaf trek-alleen maken, een schijf maken uit
 * knopen op één hoogte, een schijf verwijderen. Uitkomst: welke trek-alleen
 * staven in een berekening op druk stonden (en dus niet meededen), de
 * knikfactor per combinatie, en het tweede-ordemoment Σ N·(e_x × Δu) dat de
 * onafhankelijke momentensom bij P-Δ nodig heeft.
 *
 * Pure rekencode zonder DOM: de sidecarbundel neemt hem mee via
 * `openFem3dSolver.ts`.
 */
import { beddingTrekAlleenMelding, type OpenFem3DDiaphragm, type OpenFem3DModel } from "./openFem3dModel";

/** Toegestaan hoogteverschil binnen één schijf, in m (gelijk aan de rekenkern). */
export const OPEN_FEM_3D_DIAPHRAGM_HEIGHT_TOLERANCE_M = 1e-3;

/**
 * Zet trek-alleen aan of uit op de gegeven staven; uit = het veld verdwijnt.
 * Een staaf op bedding (#106) kan niet trek-alleen worden: geweigerd.
 */
export function setOpenFem3DTensionOnly(
  model: OpenFem3DModel, beamIds: readonly number[], on: boolean,
): OpenFem3DModel {
  const ids = new Set(beamIds);
  const opBedding = on ? model.beams.find((beam) => ids.has(beam.id) && beam.bedding) : undefined;
  if (opBedding) throw new Error(beddingTrekAlleenMelding(opBedding.id));
  return {
    ...model,
    beams: model.beams.map((beam) => {
      if (!ids.has(beam.id)) return beam;
      const { tensionOnly: _tensionOnly, ...rest } = beam;
      return on ? { ...rest, tensionOnly: true } : rest;
    }),
  };
}

/** De modelinstellingen voor trek-alleen staven (3D-analyse-instellingen). */
export type OpenFem3DTensionOnlySetting = "tensionOnlyFitAfterPermanent" | "tensionOnlyCrossRule";

/** Zet een modelinstelling voor trek-alleen staven aan of uit; uit = het veld verdwijnt. */
export function setOpenFem3DTensionOnlySetting(
  model: OpenFem3DModel, setting: OpenFem3DTensionOnlySetting, on: boolean,
): OpenFem3DModel {
  const { [setting]: _previous, ...rest } = model;
  return on ? { ...rest, [setting]: true } : rest;
}

/** De schijf waar een knoop bij hoort, of `undefined`. */
export function openFem3DDiaphragmOfNode(model: OpenFem3DModel, nodeId: number): OpenFem3DDiaphragm | undefined {
  return (model.diaphragms ?? []).find((diaphragm) => diaphragm.nodeIds.includes(nodeId));
}

export type OpenFem3DDiaphragmRefusal =
  | { kind: "tooFewNodes" }
  | { kind: "missingNode"; nodeId: number }
  | { kind: "notLevel"; lowNodeId: number; highNodeId: number; differenceMm: number }
  | { kind: "alreadyInDiaphragm"; nodeId: number; diaphragmId: number };

/**
 * Een nieuwe starre schijf uit knopen op één hoogte (binnen 1 mm). Een knoop
 * die al in een schijf zit, mag niet in een tweede.
 */
export function addOpenFem3DDiaphragm(
  model: OpenFem3DModel, nodeIds: readonly number[], name?: string,
): { ok: true; model: OpenFem3DModel; id: number } | { ok: false; refusal: OpenFem3DDiaphragmRefusal } {
  const unique = [...new Set(nodeIds)];
  if (unique.length < 2) return { ok: false, refusal: { kind: "tooFewNodes" } };
  const byId = new Map(model.nodes.map((node) => [node.id, node]));
  for (const nodeId of unique) {
    if (!byId.has(nodeId)) return { ok: false, refusal: { kind: "missingNode", nodeId } };
    const owner = openFem3DDiaphragmOfNode(model, nodeId);
    if (owner) return { ok: false, refusal: { kind: "alreadyInDiaphragm", nodeId, diaphragmId: owner.id } };
  }
  const nodes = unique.map((id) => byId.get(id)!);
  const low = nodes.reduce((best, node) => node.z < best.z ? node : best);
  const high = nodes.reduce((best, node) => node.z > best.z ? node : best);
  if (high.z - low.z > OPEN_FEM_3D_DIAPHRAGM_HEIGHT_TOLERANCE_M + 1e-9) {
    return { ok: false, refusal: {
      kind: "notLevel", lowNodeId: low.id, highNodeId: high.id, differenceMm: (high.z - low.z) * 1000,
    } };
  }
  const existing = model.diaphragms ?? [];
  const id = existing.reduce((maximum, diaphragm) => Math.max(maximum, diaphragm.id), 0) + 1;
  const trimmed = name?.trim();
  const diaphragm: OpenFem3DDiaphragm = { id, nodeIds: unique, ...(trimmed ? { name: trimmed } : {}) };
  return { ok: true, model: { ...model, diaphragms: [...existing, diaphragm] }, id };
}

export function removeOpenFem3DDiaphragm(model: OpenFem3DModel, id: number): OpenFem3DModel {
  return { ...model, diaphragms: (model.diaphragms ?? []).filter((diaphragm) => diaphragm.id !== id) };
}

/** Wat de rekenuitkomst over trek-alleen zegt: hoeveel er niet meededen en welke. */
export function openFem3DTensionOnlySummary(
  model: Pick<OpenFem3DModel, "beams">,
  result: { inactiveMembers?: readonly number[]; tensionOnlyRounds?: number } | null | undefined,
): { total: number; inactive: number; inactiveIds: number[]; rounds: number } | null {
  const total = model.beams.filter((beam) => beam.tensionOnly).length;
  if (total === 0) return null;
  const inactiveIds = [...(result?.inactiveMembers ?? [])].sort((a, b) => a - b);
  return { total, inactive: inactiveIds.length, inactiveIds, rounds: result?.tensionOnlyRounds ?? 0 };
}

/** EN 1993-1-1 5.2.1(3): eerste orde volstaat bij α_cr ≥ 10 (elastische berekening). */
export const OPEN_FEM_3D_FIRST_ORDER_ALPHA_CR = 10;

export interface OpenFem3DStabilityRow {
  /** Eerste knikfactor, of `null` als er geen is (geen drukstaaf, uitgeschakeld, mislukt). */
  alphaCr: number | null;
  /** α_cr ≥ 10: een eerste-ordeberekening volstaat volgens EN 1993-1-1 5.2.1. */
  firstOrderSufficient: boolean | null;
  /** Aantal trek-alleen staven dat in deze berekening niet meedeed, of `null` zonder trek-alleen staven. */
  inactiveTensionOnly: number | null;
}

/** Eén rapportregel per uitkomst: knikfactor en inactieve trek-alleen staven. */
export function openFem3DStabilityRow(
  model: Pick<OpenFem3DModel, "beams">,
  result: {
    buckling: { status: string; modes?: readonly { loadFactor: number }[] };
    inactiveMembers?: readonly number[];
  },
): OpenFem3DStabilityRow {
  const alphaCr = result.buckling.status === "available" ? result.buckling.modes?.[0]?.loadFactor ?? null : null;
  const tensionOnly = openFem3DTensionOnlySummary(model, result);
  return {
    alphaCr,
    firstOrderSufficient: alphaCr === null ? null : alphaCr >= OPEN_FEM_3D_FIRST_ORDER_ALPHA_CR,
    inactiveTensionOnly: tensionOnly ? tensionOnly.inactive : null,
  };
}

type Vector3 = [number, number, number];

/**
 * Het tweede-ordemoment om de globale oorsprong: Σ N·(e_x × Δu) over alle
 * elementen waarmee de kern de geometrische stijfheid K_G rekende, met N trek
 * positief en Δu = u_eind − u_begin (translaties).
 *
 * Bij een P-Δ-uitkomst zijn de reacties ((K + K_G)·u − F). K voert bij een
 * starre beweging geen kracht af, K_G bij een starre translatie ook niet: de
 * krachtensom sluit dus exact. Bij een starre rotatie a geeft K_G precies
 * a·Σ N·(e_x × Δu). De momentensom van lasten en reacties in de onvervormde
 * stand is daarom exact dit moment: de bijdrage van de normaalkrachten over
 * de verplaatste elementeinden.
 *
 * De kern rekent een gedrukte staaf in vier delen per stuk, elk met zijn
 * eigen N (controle oktober 2026, K4): bij een last langs de staafas verloopt
 * N per deel. Die delen staan in `secondOrderParts` (N en Δu per deel); een
 * staaf die daar staat telt met Σ N_deel·(e_x × Δu_deel). Een staaf zonder
 * delen (een kern van vóór K4) telt als één element met N̄ = (N_begin + N_eind)/2
 * en Δu tussen zijn knopen.
 */
export function openFem3DSecondOrderMomentKnm(
  input: {
    nodes: readonly { id: number; x: number; y: number; z: number }[];
    members: readonly { id: number; startNodeId: number; endNodeId: number }[];
  },
  result: {
    displacements: readonly { nodeId: number; ux: number; uy: number; uz: number }[];
    memberForces: readonly { memberId: number; nStartKn: number; nEndKn: number }[];
    secondOrderParts?: readonly OpenFem3DSecondOrderMemberParts[];
  },
): Vector3 {
  const nodeById = new Map(input.nodes.map((node) => [node.id, node]));
  const displacementById = new Map(result.displacements.map((value) => [value.nodeId, value]));
  const forceById = new Map(result.memberForces.map((value) => [value.memberId, value]));
  const partsById = new Map((result.secondOrderParts ?? []).map((value) => [value.memberId, value.parts]));
  const sum: Vector3 = [0, 0, 0];
  const add = (n: number, ex: Vector3, du: readonly number[]) => {
    sum[0] += n * (ex[1] * du[2] - ex[2] * du[1]);
    sum[1] += n * (ex[2] * du[0] - ex[0] * du[2]);
    sum[2] += n * (ex[0] * du[1] - ex[1] * du[0]);
  };
  for (const member of input.members) {
    const start = nodeById.get(member.startNodeId), end = nodeById.get(member.endNodeId);
    if (!start || !end) continue;
    const length = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
    const ex: Vector3 = [(end.x - start.x) / length, (end.y - start.y) / length, (end.z - start.z) / length];
    const parts = partsById.get(member.id);
    if (parts) {
      for (const part of parts) add(part.nKn, ex, part.duM);
      continue;
    }
    const force = forceById.get(member.id);
    const ua = displacementById.get(member.startNodeId), ub = displacementById.get(member.endNodeId);
    if (!force || !ua || !ub) continue;
    add((force.nStartKn + force.nEndKn) / 2, ex, [ub.ux - ua.ux, ub.uy - ua.uy, ub.uz - ua.uz]);
  }
  return sum;
}

/**
 * De delen van één staaf waarmee de kern bij P-Δ de geometrische stijfheid
 * rekende (`secondOrderParts` in de uitkomst): per deel de normaalkracht (kN,
 * trek positief) en u_eind − u_begin van zijn eindknopen (globaal, m).
 */
export interface OpenFem3DSecondOrderMemberParts {
  memberId: number;
  parts: { nKn: number; duM: [number, number, number] }[];
}

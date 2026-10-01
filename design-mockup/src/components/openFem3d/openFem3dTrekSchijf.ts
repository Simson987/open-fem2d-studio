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
import type { OpenFem3DDiaphragm, OpenFem3DModel } from "./openFem3dModel";

/** Toegestaan hoogteverschil binnen één schijf, in m (gelijk aan de rekenkern). */
export const OPEN_FEM_3D_DIAPHRAGM_HEIGHT_TOLERANCE_M = 1e-3;

/** Zet trek-alleen aan of uit op de gegeven staven; uit = het veld verdwijnt. */
export function setOpenFem3DTensionOnly(
  model: OpenFem3DModel, beamIds: readonly number[], on: boolean,
): OpenFem3DModel {
  const ids = new Set(beamIds);
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
 * staven, met N trek positief en Δu = u_eind − u_begin (translaties).
 *
 * Bij een P-Δ-uitkomst zijn de reacties ((K + K_G)·u − F). K voert bij een
 * starre beweging geen kracht af, K_G bij een starre translatie ook niet: de
 * krachtensom sluit dus exact. Bij een starre rotatie a geeft K_G precies
 * a·Σ N·(e_x × Δu). De momentensom van lasten en reacties in de onvervormde
 * stand is daarom exact dit moment: de bijdrage van de normaalkrachten over
 * de verplaatste staafeinden.
 */
export function openFem3DSecondOrderMomentKnm(
  input: {
    nodes: readonly { id: number; x: number; y: number; z: number }[];
    members: readonly { id: number; startNodeId: number; endNodeId: number }[];
  },
  result: {
    displacements: readonly { nodeId: number; ux: number; uy: number; uz: number }[];
    memberForces: readonly { memberId: number; nStartKn: number; nEndKn: number }[];
  },
): Vector3 {
  const nodeById = new Map(input.nodes.map((node) => [node.id, node]));
  const displacementById = new Map(result.displacements.map((value) => [value.nodeId, value]));
  const forceById = new Map(result.memberForces.map((value) => [value.memberId, value]));
  const sum: Vector3 = [0, 0, 0];
  for (const member of input.members) {
    const start = nodeById.get(member.startNodeId), end = nodeById.get(member.endNodeId);
    const force = forceById.get(member.id);
    const ua = displacementById.get(member.startNodeId), ub = displacementById.get(member.endNodeId);
    if (!start || !end || !force || !ua || !ub) continue;
    const length = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
    const ex: Vector3 = [(end.x - start.x) / length, (end.y - start.y) / length, (end.z - start.z) / length];
    const du: Vector3 = [ub.ux - ua.ux, ub.uy - ua.uy, ub.uz - ua.uz];
    const n = (force.nStartKn + force.nEndKn) / 2;
    sum[0] += n * (ex[1] * du[2] - ex[2] * du[1]);
    sum[1] += n * (ex[2] * du[0] - ex[0] * du[2]);
    sum[2] += n * (ex[0] * du[1] - ex[1] * du[0]);
  }
  return sum;
}

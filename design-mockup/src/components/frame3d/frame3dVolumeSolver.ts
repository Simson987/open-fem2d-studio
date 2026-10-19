import { solveNativeMixed3D, type NativeMixed3DInput, type NativeMixed3DResult } from "../../lib/nativeFemClient";
import { frame3DLoadCaseId, type Frame3DModel } from "./frame3dModel";
import type { buildFrame3DSolveRequest, Frame3DLoadSelection, Frame3DSolveResult } from "./frame3dSolver";
import { consistentFrame3DVolumeBodyLoad, consistentFrame3DVolumeFaceLoad } from "./frame3dVolumeLoads";
import { frame3DVolumeFaces } from "./frame3dVolumeFaces";
import { frame3DMemberEquivalentLoad, frame3DMemberPointEquivalentLoad } from "./frame3dMemberEquivalentLoads";
import { frame3DVolumeMemberDiagrams } from "./frame3dVolumeDiagrams";
import { eVanMateriaal, NU_BETON, NU_STAAL } from "../../lib/sectionResolver";

type Stress = [number, number, number, number, number, number];
type ResolvedFrame = ReturnType<typeof buildFrame3DSolveRequest>;
type Vector3 = [number, number, number];
type BendingPlateTriangle = { plateId: number; nodeIds: [number, number, number]; areaM2: number;
  eMpa: number; nu: number; thicknessM: number };
type CoupledBendingPlateResult = NonNullable<NonNullable<Frame3DSolveResult["volume3D"]>["bendingPlates"]>[number];

/** A polygon fan is exact only for a straight, strictly convex XY contour. */
function bendingPlateTriangles(model: Frame3DModel): BendingPlateTriangle[] {
  const byId = new Map(model.nodes.map((node) => [node.id, node]));
  const triangles: BendingPlateTriangle[] = [];
  for (const plate of model.plates ?? []) {
    if (plate.membraneOnly) continue;
    if (plate.openings?.length || plate.cornerRadiusM || plate.boundary?.some((edge) => edge.kind !== "line")
        || (plate.boundary && (plate.boundary.length !== plate.nodeIds.length
          || plate.boundary.some((edge, index) => edge.startNodeId !== plate.nodeIds[index]
            || edge.endNodeId !== plate.nodeIds[(index + 1) % plate.nodeIds.length])))) {
      throw new Error(`3D-plaat ${plate.id}: gekoppelde DKT-buiging vereist een rechte, gesloten contour zonder bogen of openingen.`);
    }
    if (plate.edgeSupports?.some((edge) => edge !== "free")
        || plate.maxCellSizeM !== undefined || plate.modulusCurve || plate.nonlinearLaw
        || plate.reinforcement || plate.threeLayer) {
      throw new Error(`3D-plaat ${plate.id}: gekoppelde DKT-buiging ondersteunt geen randopleggingen, roostermaat, materiaal-FNL of plaattoetsing.`);
    }
    const material = plate.material?.trim() ?? "";
    const resolved = eVanMateriaal(material);
    if (!(resolved.E > 0) || !Number.isFinite(resolved.E)
        || (resolved.soort !== "beton" && resolved.soort !== "staal")) {
      throw new Error(`3D-plaat ${plate.id}: gekoppelde DKT-buiging vereist expliciet isotroop beton of staal met bekende E en ν.`);
    }
    const corners = plate.nodeIds.map((id) => byId.get(id));
    if (corners.length < 3 || corners.some((node) => !node)) {
      throw new Error(`3D-plaat ${plate.id}: minstens drie bestaande contourknopen zijn vereist.`);
    }
    const points = corners as NonNullable<typeof corners[number]>[];
    let span = 1;
    for (const node of points) span = Math.max(span, Math.hypot(node.x - points[0].x, node.y - points[0].y));
    if (points.some((node) => Math.abs(node.z - points[0].z) > 1e-9 * span)) {
      throw new Error(`3D-plaat ${plate.id}: gekoppelde DKT-buiging ondersteunt alleen horizontale XY-platen.`);
    }
    const signedArea = (a: typeof points[number], b: typeof points[number], c: typeof points[number]) =>
      (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const tolerance = 1e-12 * span * span;
    const sign = Math.sign(signedArea(points[0], points[1], points[2]));
    // Every other vertex must lie strictly inside each oriented edge. This
    // also rejects self-crossing star loops that have same-signed local turns.
    if (!sign || points.some((a, index) => points.some((point, other) =>
      other !== index && other !== (index + 1) % points.length
      && sign * signedArea(a, points[(index + 1) % points.length], point) <= tolerance))) {
      throw new Error(`3D-plaat ${plate.id}: de XY-contour moet strikt convex zijn voor driehoeksverdeling.`);
    }
    for (let index = 1; index < points.length - 1; index++) {
      const a = points[0], b = points[index], c = points[index + 1];
      const areaM2 = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;
      if (!(areaM2 > tolerance / 2)) throw new Error(`3D-plaat ${plate.id}: ongeldige DKT-driehoek.`);
      triangles.push({ plateId: plate.id,
        nodeIds: sign > 0 ? [plate.nodeIds[0], plate.nodeIds[index], plate.nodeIds[index + 1]]
          : [plate.nodeIds[0], plate.nodeIds[index + 1], plate.nodeIds[index]],
        areaM2, eMpa: resolved.E, nu: resolved.soort === "beton" ? NU_BETON : NU_STAAL,
        thicknessM: plate.thicknessM });
    }
  }
  return triangles;
}

function factorFor(selection: Frame3DLoadSelection | undefined, caseId: number): number {
  if (selection === undefined) return 1;
  if (typeof selection === "number") return selection === caseId ? 1 : 0;
  const factor = selection.get(caseId) ?? 0;
  if (!Number.isFinite(factor)) throw new Error(`Belastinggeval ${caseId}: ongeldige combinatiefactor.`);
  return factor;
}

function finiteTriplet(value: unknown): value is Vector3 {
  return Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === "number" && Number.isFinite(item));
}

function finiteStress(value: unknown): value is Stress {
  return Array.isArray(value) && value.length === 6 && value.every((item) => typeof item === "number" && Number.isFinite(item));
}

function vonMises([sx, sy, sz, txy, tyz, tzx]: Stress): number {
  return Math.sqrt(Math.max(0, ((sx - sy) ** 2 + (sy - sz) ** 2 + (sz - sx) ** 2) / 2
    + 3 * (txy ** 2 + tyz ** 2 + tzx ** 2)));
}

function cross([ax, ay, az]: Vector3, [bx, by, bz]: Vector3): Vector3 {
  return [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
}

/** Adapter for the ordinary 3D editor's linear Tet4/Hex8/beam model. */
export async function solveFrame3DVolume(
  model: Frame3DModel,
  selection?: Frame3DLoadSelection,
  frame?: ResolvedFrame,
  analysis: "linear" | "p-delta" | "material" | "combined" = "linear",
): Promise<Frame3DSolveResult> {
  const volumes = model.volumes ?? [];
  if (volumes.length === 0 && !model.beams.some((beam) => beam.axialOnly)) {
    throw new Error("Voeg een Tet4-, Hex8- of axiale 3D-staaf toe.");
  }
  const membranes = (model.plates ?? []).filter((plate) => plate.membraneOnly);
  const bendingPlates = (model.plates ?? []).filter((plate) => !plate.membraneOnly);
  if (analysis === "p-delta" && (volumes.some((volume) => volume.kind !== "tet4")
      || model.beams.length > 0 || (model.plates?.length ?? 0) > 0)) {
    throw new Error("De experimentele 3D-GNL-route ondersteunt voorlopig alleen Tet4-volumes, zonder Hex8, staven of platen.");
  }
  if ((model.plateEdgeLoads?.length ?? 0) > 0) {
    throw new Error("De gemengde 3D-kern ondersteunt nog geen plaatrandlasten.");
  }
  const bendingTriangles = bendingPlateTriangles(model);
  if ((model.thermalLoads?.length ?? 0) > 0) {
    throw new Error("Volume-raamwerkmodellen ondersteunen nog geen temperatuurbelasting op staven.");
  }
  if (model.beams.some((beam) => Object.values(beam.releases ?? {}).some(Boolean))) {
    throw new Error("Volume-raamwerkmodellen ondersteunen nog geen staafscharnieren.");
  }
  const axialBeams = model.beams.filter((beam) => beam.axialOnly);
  const bendingBeams = model.beams.filter((beam) => !beam.axialOnly);
  if (analysis !== "linear" && bendingPlates.length > 0) {
    if ((analysis !== "material" && analysis !== "combined")
        || model.volumeMaterialKinematics !== "finiteStrain" || bendingBeams.length === 0
        || volumes.length === 0 || volumes.some((volume) => volume.materialLaw?.kind !== "steelJ2")) {
      throw new Error("Gekoppelde DKT-buigplaten ondersteunen alleen lineaire analyse of elastische plaatbuiging in de eindige-rek J2-volume/raamwerkroute.");
    }
    const volumeNodes = new Set(volumes.flatMap((volume) => volume.nodeIds));
    if (bendingTriangles.length > 10_000 || bendingTriangles.some((triangle) =>
      triangle.nodeIds.some((id) => !volumeNodes.has(id)))) {
      throw new Error("Gekoppelde DKT-buigplaten in J2-volume/raamwerk vereisen maximaal 10.000 driehoeken met uitsluitend Tet4/Hex8-volumegebonden knopen.");
    }
  }
  if (analysis === "combined" && (bendingBeams.length === 0
      || model.volumeMaterialKinematics !== "finiteStrain"
      || volumes.some((volume) => volume.materialLaw?.kind !== "steelJ2"))) {
    throw new Error("Gecombineerde 3D-GNL/FNL vereist volledige buigende staven en eindige-rek J2-staal op ieder volume-element.");
  }
  if ((analysis === "material" || analysis === "combined") && axialBeams.length > 0
      && (model.volumeMaterialKinematics !== "finiteStrain"
        || volumes.some((volume) => volume.materialLaw?.kind !== "steelJ2"))) {
    throw new Error("Tet4 met axiale trekstaven of Tri3-membranen ondersteunt materiaal-FNL alleen voor eindige-rek J2-staalvolumes.");
  }
  if (axialBeams.some((beam) => beam.nonlinearLaw)) {
    if ((analysis !== "material" && analysis !== "combined") || model.volumeMaterialKinematics !== "finiteStrain"
        || volumes.some((volume) => volume.materialLaw?.kind !== "steelJ2")) {
      throw new Error("Plastische trekstaven vereisen een eindige-rek materiaal-FNL-analyse met J2-staal in alle volumes.");
    }
    if (axialBeams.some((beam) => beam.nonlinearLaw
        && (beam.nonlinearLaw.kind !== "steelBilinear" || beam.nonlinearLaw.hardeningRatio >= 1))) {
      throw new Error("Gekoppelde trekstaven ondersteunen staalplastificatie met een verhardingsverhouding van 0 tot minder dan 1.");
    }
  }
  if (membranes.some((plate) => plate.nonlinearLaw)) {
    if ((analysis !== "material" && analysis !== "combined") || model.volumeMaterialKinematics !== "finiteStrain"
        || volumes.some((volume) => volume.materialLaw?.kind !== "steelJ2")) {
      throw new Error("Plastische Tri3-membranen vereisen eindige-rek materiaal-FNL met J2-staal in alle volumes.");
    }
    if (membranes.some((plate) => plate.nonlinearLaw
        && (plate.nonlinearLaw.kind !== "steelBilinear" || plate.nonlinearLaw.hardeningRatio >= 1))) {
      throw new Error("Gekoppelde Tri3-membranen ondersteunen alleen staalplastificatie met een verhardingsverhouding kleiner dan 1.");
    }
  }
  const frameNodes = new Set(bendingBeams.flatMap((beam) => [beam.startNodeId, beam.endNodeId]));
  const plateRotationNodes = new Set(bendingTriangles.flatMap((triangle) => triangle.nodeIds));
  const usedIds = new Set<number>([...volumes.flatMap((volume) => volume.nodeIds),
    ...membranes.flatMap((plate) => plate.nodeIds),
    ...plateRotationNodes,
    ...model.beams.flatMap((beam) => [beam.startNodeId, beam.endNodeId])]);
  const nodes = model.nodes.filter((node) => usedIds.has(node.id));
  const nodeIndex = new Map(nodes.map((node, index) => [node.id, index]));
  if (nodeIndex.size !== usedIds.size) throw new Error("Een volume, membraan of staaf verwijst naar een ontbrekende knoop.");
  const indexOf = (id: number) => {
    const index = nodeIndex.get(id);
    if (index === undefined) throw new Error(`3D-knoop ${id} is niet verbonden met een volume, membraan of staaf.`);
    return index;
  };
  const tets = volumes.filter((volume) => volume.kind === "tet4");
  const hexes = volumes.filter((volume) => volume.kind === "hex8");
  const loadsKn: Vector3[] = nodes.map(() => [0, 0, 0]);
  const appliedLoadsKn: Vector3[] = nodes.map(() => [0, 0, 0]);
  const momentsKnm: Vector3[] = nodes.map(() => [0, 0, 0]);
  const appliedMomentsKnm: Vector3[] = nodes.map(() => [0, 0, 0]);
  const nativeFrameMemberLoads: Array<{ beamId: number; qyStartKnPerM: number; qyEndKnPerM: number;
    qzStartKnPerM: number; qzEndKnPerM: number; startPositionM: number; endPositionM: number }> = [];
  const nativeFrameMemberPointLoads: Array<{ beamId: number; pyKn: number; pzKn: number; positionM: number }> = [];
  // Native finite-J2 frame targets own line and point loads. Keep their app
  // equivalents only for the displayed global force and moment balance.
  let activeLoad = false;
  for (const load of model.loads ?? []) {
    const factor = factorFor(selection, frame3DLoadCaseId(load));
    if (factor === 0) continue;
    const components = [load.fx, load.fy, load.fz, load.mx, load.my, load.mz];
    if (components.some((value) => !Number.isFinite(value))) throw new Error(`3D-belasting ${load.id}: ongeldige kracht of moment.`);
    const index = indexOf(load.nodeId);
    for (let axis = 0; axis < 3; axis++) {
      loadsKn[index][axis] += components[axis] * factor;
      appliedLoadsKn[index][axis] += components[axis] * factor;
      momentsKnm[index][axis] += components[axis + 3] * factor;
      appliedMomentsKnm[index][axis] += components[axis + 3] * factor;
    }
    activeLoad ||= components.some((value) => value * factor !== 0);
    const unsupportedPlateMoment = !plateRotationNodes.has(load.nodeId)
      && (components[3] !== 0 || components[4] !== 0);
    if (!frameNodes.has(load.nodeId) && factor !== 0
        && (unsupportedPlateMoment || components[5] !== 0)) {
      throw new Error(`3D-knoop ${load.nodeId}: Mx/My vereisen een DKT-plaat of raamwerkstaaf; Mz vereist een raamwerkstaaf.`);
    }
  }
  const beamById = new Map(model.beams.map((beam) => [beam.id, beam]));
  const allNodesById = new Map(model.nodes.map((node) => [node.id, node]));
  for (const load of model.memberLoads ?? []) {
    const factor = factorFor(selection, frame3DLoadCaseId(load));
    if (factor === 0) continue;
    const beam = beamById.get(load.beamId);
    if (beam?.axialOnly) throw new Error(`Staaflast ${load.id}: een axiale trekstaaf draagt geen dwarse staaflast.`);
    const start = beam && allNodesById.get(beam.startNodeId);
    const end = beam && allNodesById.get(beam.endNodeId);
    if (!beam || !start || !end) throw new Error(`Staaflast ${load.id}: staaf of eindknoop ontbreekt.`);
    const equivalent = frame3DMemberEquivalentLoad(beam, start, end, load, factor);
    if (analysis === "linear") nativeFrameMemberLoads.push({ beamId: beam.id,
      qyStartKnPerM: load.qyStart * factor, qyEndKnPerM: load.qyEnd * factor,
      qzStartKnPerM: load.qzStart * factor, qzEndKnPerM: load.qzEnd * factor,
      startPositionM: load.startPositionM, endPositionM: load.endPositionM });
    for (const [endIndex, nodeId] of [beam.startNodeId, beam.endNodeId].entries()) {
      const index = indexOf(nodeId);
      for (let axis = 0; axis < 3; axis++) {
        if (analysis === "p-delta") loadsKn[index][axis] += equivalent.global[endIndex].forceKn[axis];
        appliedLoadsKn[index][axis] += equivalent.global[endIndex].forceKn[axis];
        if (analysis === "p-delta") momentsKnm[index][axis] += equivalent.global[endIndex].momentKnm[axis];
        appliedMomentsKnm[index][axis] += equivalent.global[endIndex].momentKnm[axis];
      }
    }
    activeLoad = true;
  }
  for (const load of model.memberPointLoads ?? []) {
    const factor = factorFor(selection, frame3DLoadCaseId(load));
    if (factor === 0) continue;
    const beam = beamById.get(load.beamId);
    if (beam?.axialOnly) throw new Error(`Staafpuntlast ${load.id}: een axiale trekstaaf draagt geen dwarse staaflast.`);
    const start = beam && allNodesById.get(beam.startNodeId);
    const end = beam && allNodesById.get(beam.endNodeId);
    if (!beam || !start || !end) throw new Error(`Staafpuntlast ${load.id}: staaf of eindknoop ontbreekt.`);
    const equivalent = frame3DMemberPointEquivalentLoad(beam, start, end, load, factor);
    if (analysis === "linear") nativeFrameMemberPointLoads.push({ beamId: beam.id,
      pyKn: load.py * factor, pzKn: load.pz * factor, positionM: load.positionM });
    for (const [endIndex, nodeId] of [beam.startNodeId, beam.endNodeId].entries()) {
      const index = indexOf(nodeId);
      for (let axis = 0; axis < 3; axis++) {
        if (analysis === "p-delta") loadsKn[index][axis] += equivalent.global[endIndex].forceKn[axis];
        appliedLoadsKn[index][axis] += equivalent.global[endIndex].forceKn[axis];
        if (analysis === "p-delta") momentsKnm[index][axis] += equivalent.global[endIndex].momentKnm[axis];
        appliedMomentsKnm[index][axis] += equivalent.global[endIndex].momentKnm[axis];
      }
    }
    activeLoad = true;
  }
  const tetIndex = new Map(tets.map((volume, index) => [volume.id, index]));
  const hexIndex = new Map(hexes.map((volume, index) => [volume.id, index]));
  const volumeById = new Map(volumes.map((volume) => [volume.id, volume]));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const tetBodyForces: NonNullable<NativeMixed3DInput["tetBodyForces"]> = [];
  const hexBodyForces: NonNullable<NativeMixed3DInput["hexBodyForces"]> = [];
  const tetFaceTractions: NonNullable<NativeMixed3DInput["tetFaceTractions"]> = [];
  const hexFaceTractions: NonNullable<NativeMixed3DInput["hexFaceTractions"]> = [];
  for (const load of model.volumeBodyLoads ?? []) {
    const factor = factorFor(selection, frame3DLoadCaseId(load));
    if (factor === 0) continue;
    const volume = volumeById.get(load.volumeId);
    if (!volume) throw new Error(`Volumekracht ${load.id}: volume ${load.volumeId} ontbreekt.`);
    const forceKnPerM3 = load.forceKnPerM3.map((component) => component * factor) as Vector3;
    if (forceKnPerM3.some((component) => !Number.isFinite(component))) {
      throw new Error(`Volumekracht ${load.id}: ongeldige kracht of combinatiefactor.`);
    }
    for (const equivalent of consistentFrame3DVolumeBodyLoad(volume, nodeById, forceKnPerM3)) {
      const index = indexOf(equivalent.nodeId);
      for (let axis = 0; axis < 3; axis++) appliedLoadsKn[index][axis] += equivalent.forceKn[axis];
    }
    if (volume.kind === "tet4") tetBodyForces.push({ element: tetIndex.get(volume.id)!, forceKnPerM3 });
    else hexBodyForces.push({ element: hexIndex.get(volume.id)!, forceKnPerM3 });
    activeLoad = true;
  }
  for (const load of model.volumeFaceLoads ?? []) {
    const factor = factorFor(selection, frame3DLoadCaseId(load));
    if (factor === 0) continue;
    const volume = volumeById.get(load.volumeId);
    if (!volume) throw new Error(`Volumevlaktractie ${load.id}: volume ${load.volumeId} ontbreekt.`);
    const tractionKnPerM2 = load.tractionKnPerM2.map((component) => component * factor) as Vector3;
    if (tractionKnPerM2.some((component) => !Number.isFinite(component))) {
      throw new Error(`Volumevlaktractie ${load.id}: ongeldige tractie of combinatiefactor.`);
    }
    const face = frame3DVolumeFaces(volume.kind)[load.faceIndex];
    if (!face) throw new Error(`Volumevlaktractie ${load.id}: ongeldig vlak ${load.faceIndex + 1}.`);
    for (const equivalent of consistentFrame3DVolumeFaceLoad(volume, nodeById, load.faceIndex, tractionKnPerM2)) {
      const index = indexOf(equivalent.nodeId);
      for (let axis = 0; axis < 3; axis++) appliedLoadsKn[index][axis] += equivalent.forceKn[axis];
    }
    if (volume.kind === "tet4") tetFaceTractions.push({ element: tetIndex.get(volume.id)!,
      nodes: face.map((local) => indexOf(volume.nodeIds[local])) as [number, number, number], tractionKnPerM2 });
    else hexFaceTractions.push({ element: hexIndex.get(volume.id)!,
      faceNodes: [...face] as [number, number, number, number], tractionKnPerM2 });
    activeLoad = true;
  }
  const membraneById = new Map(membranes.map((plate) => [plate.id, plate]));
  const membraneIndex = new Map(membranes.map((plate, index) => [plate.id, index]));
  const bendingTrianglesByPlate = new Map<number, BendingPlateTriangle[]>();
  for (const triangle of bendingTriangles) {
    const group = bendingTrianglesByPlate.get(triangle.plateId) ?? [];
    group.push(triangle);
    bendingTrianglesByPlate.set(triangle.plateId, group);
  }
  const membraneTractions: NonNullable<NativeMixed3DInput["membraneTractions"]> = [];
  for (const load of model.surfaceLoads ?? []) {
    const factor = factorFor(selection, frame3DLoadCaseId(load));
    if (factor === 0) continue;
    const plate = membraneById.get(load.plateId);
    if (!plate) {
      const triangles = bendingTrianglesByPlate.get(load.plateId);
      if (!triangles) throw new Error(`Plaatlast ${load.id}: plaat ${load.plateId} ontbreekt in het gekoppelde model.`);
      if (![load.qx, load.qy, load.qz].every(Number.isFinite) || load.qx !== 0 || load.qy !== 0) {
        throw new Error(`Plaatlast ${load.id}: een gekoppelde DKT-buigplaat draagt alleen globale z-druk; qx/qy vereisen membraanstijfheid.`);
      }
      for (const triangle of triangles) {
        const nodalForceKn = load.qz * factor * triangle.areaM2 / 3;
        if (!Number.isFinite(nodalForceKn)) throw new Error(`Plaatlast ${load.id}: ongeldige z-druk of combinatiefactor.`);
        for (const nodeId of triangle.nodeIds) {
          const index = indexOf(nodeId);
          loadsKn[index][2] += nodalForceKn;
          appliedLoadsKn[index][2] += nodalForceKn;
        }
      }
      activeLoad ||= load.qz !== 0;
      continue;
    }
    const [a, b, c] = plate.nodeIds.map((id) => nodeById.get(id));
    if (!a || !b || !c) throw new Error(`Tri3-membraan ${plate.id}: knoop ontbreekt.`);
    const ab: Vector3 = [b.x - a.x, b.y - a.y, b.z - a.z];
    const ac: Vector3 = [c.x - a.x, c.y - a.y, c.z - a.z];
    const areaM2 = Math.hypot(...cross(ab, ac)) / 2;
    const tractionKnPerM2 = [load.qx, load.qy, load.qz]
      .map((value) => value * factor) as Vector3;
    const nodalForce = tractionKnPerM2.map((value) => value * areaM2 / 3);
    if (!(areaM2 > 0) || tractionKnPerM2.some((value) => !Number.isFinite(value))
        || nodalForce.some((value) => !Number.isFinite(value))) {
      throw new Error(`Tri3-membraan ${plate.id}: ongeldige plaatlast of oppervlakte.`);
    }
    if (analysis === "linear") membraneTractions.push({ element: membraneIndex.get(plate.id)!, tractionKnPerM2 });
    for (const nodeId of plate.nodeIds) {
      const index = indexOf(nodeId);
      for (let axis = 0; axis < 3; axis++) {
        if (analysis !== "linear") loadsKn[index][axis] += nodalForce[axis];
        appliedLoadsKn[index][axis] += nodalForce[axis];
      }
    }
    activeLoad = true;
  }
  const prescribedM: NativeMixed3DInput["prescribedM"] = nodes.map(() => [null, null, null]);
  const prescribedRotationsRad: NonNullable<NativeMixed3DInput["prescribedRotationsRad"]> = nodes.map(() => [null, null, null]);
  for (const support of model.supports ?? []) {
    const index = indexOf(support.nodeId);
    if (Object.values(support.springs ?? {}).some((value) => value !== undefined && value !== 0)) {
      throw new Error(`3D-oplegging ${support.nodeId}: veren zijn nog niet beschikbaar voor gemengde volume-modellen.`);
    }
    const translations = ["ux", "uy", "uz"] as const;
    const prescribedTranslation = ["uxM", "uyM", "uzM"] as const;
    const rotations = ["rx", "ry", "rz"] as const;
    const prescribedRotation = ["rxRad", "ryRad", "rzRad"] as const;
    for (let axis = 0; axis < 3; axis++) {
      const value = support.prescribed?.[prescribedTranslation[axis]];
      if (value !== undefined && !support[translations[axis]]) throw new Error(`3D-oplegging ${support.nodeId}: opgelegde verplaatsing vereist een geblokkeerde richting.`);
      if (value !== undefined && !Number.isFinite(value)) throw new Error(`3D-oplegging ${support.nodeId}: ongeldige opgelegde verplaatsing.`);
      if (support[translations[axis]]) prescribedM[index][axis] = value ?? 0;
      const angle = support.prescribed?.[prescribedRotation[axis]];
      if (angle !== undefined && !support[rotations[axis]]) throw new Error(`3D-oplegging ${support.nodeId}: opgelegde rotatie vereist een geblokkeerde richting.`);
      if (angle !== undefined && !Number.isFinite(angle)) throw new Error(`3D-oplegging ${support.nodeId}: ongeldige opgelegde rotatie.`);
      const hasRotation = frameNodes.has(support.nodeId) || axis < 2 && plateRotationNodes.has(support.nodeId);
      if (hasRotation && support[rotations[axis]]) prescribedRotationsRad[index][axis] = angle ?? 0;
      if (!hasRotation && angle !== undefined && angle !== 0) {
        throw new Error(`3D-knoop ${support.nodeId}: opgelegde rotatie vereist een aangesloten raamwerkstaaf of een DKT-plaat voor Rx/Ry.`);
      }
    }
  }
  const hasPrescribed = prescribedM.some((entry) => entry.some((value) => value !== null && value !== 0))
    || prescribedRotationsRad.some((entry) => entry.some((value) => value !== null && value !== 0));
  if (!activeLoad && !hasPrescribed) throw new Error("Voeg een 3D-belasting of opgelegde verplaatsing toe.");
  if (analysis === "p-delta") {
    const { solveFrame3DVolumeGnl } = await import("./frame3dVolumeGnl");
    return solveFrame3DVolumeGnl(model, nodes, tets, loadsKn, appliedLoadsKn,
      prescribedM, tetBodyForces, tetFaceTractions);
  }
  if (analysis === "material" || analysis === "combined") {
    const { solveFrame3DVolumeMaterial } = await import("./frame3dVolumeMaterial");
    const materials = new Map(frame?.materials.map((material) => [material.id, material]) ?? []);
    const sections = new Map(frame?.sections.map((section) => [section.id, section]) ?? []);
    const members = new Map(frame?.members.map((member) => [member.id, member]) ?? []);
    const coupledTrusses = axialBeams.map((beam) => {
      const member = members.get(beam.id);
      const material = member && materials.get(member.materialId);
      const section = member && sections.get(member.sectionId);
      if (!member || !material || !section) {
        throw new Error(`Trekstaaf ${beam.id}: materiaal of doorsnede ontbreekt voor de gekoppelde eindige-rekberekening.`);
      }
      return { memberId: beam.id,
        nodes: [indexOf(beam.startNodeId), indexOf(beam.endNodeId)] as [number, number],
        youngsMpa: material.eMpa, areaM2: section.areaM2,
        ...(beam.nonlinearLaw?.kind === "steelBilinear" ? { plasticity: {
          yieldMpa: beam.nonlinearLaw.yieldMpa,
          hardeningMpa: material.eMpa * beam.nonlinearLaw.hardeningRatio
            / (1 - beam.nonlinearLaw.hardeningRatio),
        } } : {}) };
    });
    const coupledFrames = bendingBeams.map((beam) => {
      if (beam.nonlinearLaw) {
        throw new Error(`Staaf ${beam.id}: gekoppeld volume-J2 ondersteunt momenteel alleen elastische buigende 3D-staven.`);
      }
      const member = members.get(beam.id);
      const material = member && materials.get(member.materialId);
      const section = member && sections.get(member.sectionId);
      if (!member || !material || !section) {
        throw new Error(`Staaf ${beam.id}: materiaal of doorsnede ontbreekt voor de gekoppelde eindige-rekberekening.`);
      }
      return { memberId: beam.id,
        nodes: [indexOf(beam.startNodeId), indexOf(beam.endNodeId)] as [number, number],
        youngsMpa: material.eMpa, poisson: material.nu, areaM2: section.areaM2,
        iyM4: section.iyM4, izM4: section.izM4, torsionJM4: section.torsionJM4,
        ...(material.gMpa !== undefined ? { gMpa: material.gMpa } : {}),
        ...(member.rollAngleRad !== undefined ? { rollAngleRad: member.rollAngleRad } : {}),
      };
    });
    return solveFrame3DVolumeMaterial(model, nodes, tets, loadsKn, appliedLoadsKn,
      prescribedM, tetBodyForces, tetFaceTractions, coupledTrusses,
      membranes.map((plate) => ({ plateId: plate.id,
        nodes: plate.nodeIds.map(indexOf) as [number, number, number],
        youngsMpa: plate.membraneEMpa!, poisson: plate.membranePoisson!,
        thicknessM: plate.thicknessM,
        ...(plate.nonlinearLaw?.kind === "steelBilinear" ? { plasticity: {
          yieldMpa: plate.nonlinearLaw.yieldMpa,
          hardeningMpa: plate.membraneEMpa! * plate.nonlinearLaw.hardeningRatio
            / (1 - plate.nonlinearLaw.hardeningRatio),
        } } : {}) })), hexes, hexBodyForces, hexFaceTractions,
      coupledFrames, momentsKnm, appliedMomentsKnm, prescribedRotationsRad,
      analysis === "combined",
      (model.memberLoads ?? []).map((load) => ({ load,
        factor: factorFor(selection, frame3DLoadCaseId(load)) })).filter(({ factor }) => factor !== 0),
      (model.memberPointLoads ?? []).map((load) => ({ load,
        factor: factorFor(selection, frame3DLoadCaseId(load)) })).filter(({ factor }) => factor !== 0),
      bendingTriangles.map((triangle) => ({ plateId: triangle.plateId, nodeIds: triangle.nodeIds,
        nodes: triangle.nodeIds.map(indexOf) as [number, number, number],
        youngsMpa: triangle.eMpa, poisson: triangle.nu, thicknessM: triangle.thicknessM })));
  }
  if (model.volumeBackend === "sparseGmres" || model.volumeBackend === "matrixFreeGmres"
      || model.volumeBackend === "matrixFreeGmresLarge") {
    throw new Error("GMRES-oplossers zijn alleen beschikbaar voor passende Tet4-materiaal-FNL-routes.");
  }
  const materials = new Map(frame?.materials.map((material) => [material.id, material]) ?? []);
  const sections = new Map(frame?.sections.map((section) => [section.id, section]) ?? []);
  const resolvedMembers = frame?.members ?? [];
  const resolved = (member: typeof resolvedMembers[number]) => {
    const material = materials.get(member.materialId);
    const section = sections.get(member.sectionId);
    if (!material || !section) throw new Error(`Staaf ${member.id}: materiaal of doorsnede ontbreekt.`);
    return { material, section };
  };
  const frames: NonNullable<NativeMixed3DInput["frames"]> = resolvedMembers
    .filter((member) => !beamById.get(member.id)?.axialOnly).map((member) => {
    const { material, section } = resolved(member);
    return {
      nodes: [indexOf(member.startNodeId), indexOf(member.endNodeId)],
      eMpa: material.eMpa, poisson: material.nu, gMpa: material.gMpa, areaM2: section.areaM2,
      iyM4: section.iyM4, izM4: section.izM4, torsionJM4: section.torsionJM4,
      ...(member.rollAngleRad !== undefined ? { rollAngleRad: member.rollAngleRad } : {}),
    };
  });
  const frameElementIndexById = new Map(resolvedMembers
    .filter((member) => !beamById.get(member.id)?.axialOnly)
    .map((member, index) => [member.id, index]));
  const frameElementOf = (beamId: number) => {
    const index = frameElementIndexById.get(beamId);
    if (index === undefined) throw new Error(`Staaf ${beamId}: ontbreekt in de gekoppelde raamwerkelementen.`);
    return index;
  };
  const trusses: NativeMixed3DInput["trusses"] = resolvedMembers
    .filter((member) => beamById.get(member.id)?.axialOnly).map((member) => {
      const { material, section } = resolved(member);
      return { nodes: [indexOf(member.startNodeId), indexOf(member.endNodeId)],
        eMpa: material.eMpa, areaM2: section.areaM2 };
    });
  // The wire format requires a solid material even when no solid is present.
  // It is unused by the Rust operator for a truss-only mesh.
  const firstMaterial = volumes[0];
  const fallbackMaterial = trusses[0];
  const input: NativeMixed3DInput = {
    mesh: { nodes: nodes.map((node) => [node.x, node.y, node.z]),
      tets: tets.map((tet) => tet.nodeIds.map(indexOf) as [number, number, number, number]) },
    solidMaterial: { eMpa: firstMaterial?.eMpa ?? fallbackMaterial?.eMpa ?? frames[0]?.eMpa ?? 1,
      poisson: firstMaterial?.poisson ?? 0.3 },
    ...(tets.length > 0 ? { tetMaterials: tets.map((tet) => ({ eMpa: tet.eMpa, poisson: tet.poisson })) } : {}),
    hexes: hexes.map((hex) => ({ nodes: hex.nodeIds.map(indexOf) as NativeMixed3DInput["hexes"] extends Array<infer H> ? H extends { nodes: infer N } ? N : never : never,
      eMpa: hex.eMpa, poisson: hex.poisson })),
    membranes: membranes.map((plate) => ({ nodes: plate.nodeIds.map(indexOf) as [number, number, number],
      eMpa: plate.membraneEMpa!, nu: plate.membranePoisson!, thicknessM: plate.thicknessM })),
    bendingPlates: bendingTriangles.map((triangle) => ({
      nodes: triangle.nodeIds.map(indexOf) as [number, number, number],
      eMpa: triangle.eMpa, nu: triangle.nu, thicknessM: triangle.thicknessM,
    })),
    membraneTractions,
    trusses, frames,
    frameMemberLoads: nativeFrameMemberLoads.map(({ beamId, ...entry }) =>
      ({ element: frameElementOf(beamId), ...entry })),
    frameMemberPointLoads: nativeFrameMemberPointLoads.map(({ beamId, ...entry }) =>
      ({ element: frameElementOf(beamId), ...entry })),
    loadsKn, momentsKnm, tetBodyForces, hexBodyForces, tetFaceTractions, hexFaceTractions,
    prescribedM, prescribedRotationsRad,
    backend: model.volumeBackend ?? "automatic", threads: model.volumeThreads ?? 4,
  };
  const native = await solveNativeMixed3D(input);
  return adaptVolumeResult(model, nodes, volumes, membranes, bendingTriangles,
    appliedLoadsKn, appliedMomentsKnm,
    selection, native);
}

function adaptVolumeResult(
  model: Frame3DModel,
  nodes: Frame3DModel["nodes"],
  volumes: NonNullable<Frame3DModel["volumes"]>,
  membranes: NonNullable<Frame3DModel["plates"]>,
  bendingTriangles: BendingPlateTriangle[],
  loadsKn: Vector3[],
  momentsKnm: Vector3[],
  selection: Frame3DLoadSelection | undefined,
  native: NativeMixed3DResult,
): Frame3DSolveResult {
  const tets = volumes.filter((volume) => volume.kind === "tet4");
  const hexes = volumes.filter((volume) => volume.kind === "hex8");
  const bendingPlates = (model.plates ?? []).filter((plate) => !plate.membraneOnly);
  const bendingBeams = model.beams.filter((beam) => !beam.axialOnly);
  const axialBeams = model.beams.filter((beam) => beam.axialOnly);
  const validVec = (items: unknown) => Array.isArray(items) && items.length === nodes.length && items.every(finiteTriplet);
  if (!validVec(native.nodalDisplacementsM) || !validVec(native.nodalReactionsKn)
      || native.solidElementStressMpa?.length !== tets.length
      || native.hexGaussStressMpa?.length !== hexes.length
      || (native.membraneStressMpa ?? []).length !== membranes.length
      || (native.membraneResultantsKnPerM ?? []).length !== membranes.length
      || native.frameEndForcesLocal?.length !== bendingBeams.length
      || native.trussAxialForceKn?.length !== axialBeams.length
      || native.trussAxialForceKn.some((force) => !Number.isFinite(force))
      || !Number.isFinite(native.relativeResidual) || native.relativeResidual < 0
      || native.relativeResidual > 1e-7 || !Number.isSafeInteger(native.linearIterations)
      || native.linearIterations < 0) {
    throw new Error("De Rust-volume-kern leverde geen volledig of nauwkeurig resultaat.");
  }
  const rotations = native.nodalRotationsRad.length === nodes.length ? native.nodalRotationsRad : nodes.map(() => null);
  const reactionMoments = native.nodalMomentReactionsKnm.length === nodes.length ? native.nodalMomentReactionsKnm : nodes.map(() => null);
  if (rotations.some((item) => item !== null && !finiteTriplet(item))
      || reactionMoments.some((item) => item !== null && !finiteTriplet(item))) {
    throw new Error("De Rust-volume-kern leverde ongeldige raamwerkrotaties of momenten.");
  }
  const plateCentroidMoments = native.bendingPlateMomentsKnmPerM === undefined
    ? [] : native.bendingPlateMomentsKnmPerM;
  if (!Array.isArray(plateCentroidMoments)
      || plateCentroidMoments.length !== bendingTriangles.length
      || !plateCentroidMoments.every(finiteTriplet)) {
    throw new Error("De Rust-volume-kern leverde geen geldige XY-DKT-centroïdebuigmomenten per driehoek.");
  }
  const displacements = nodes.map((node, index) => {
    const [ux, uy, uz] = native.nodalDisplacementsM[index];
    const [rx, ry, rz] = rotations[index] ?? [0, 0, 0];
    return { nodeId: node.id, ux, uy, uz, rx, ry, rz };
  });
  const reactions = nodes.map((node, index) => {
    const [fx, fy, fz] = native.nodalReactionsKn[index];
    const [mx, my, mz] = reactionMoments[index] ?? [0, 0, 0];
    return { nodeId: node.id, fx, fy, fz, mx, my, mz };
  });
  const displacementById = new Map(displacements.map((node) => [node.nodeId, node]));
  const bendingResultByPlate = new Map<number, CoupledBendingPlateResult>();
  for (const [triangleIndex, triangle] of bendingTriangles.entries()) {
    let entry = bendingResultByPlate.get(triangle.plateId);
    if (!entry) {
      entry = { plateId: triangle.plateId, triangleCount: 0, maxAbsWm: 0, maxAbsRotationRad: 0,
        maxAbsMomentKnmPerM: [0, 0, 0], centroidMoments: [] };
      bendingResultByPlate.set(triangle.plateId, entry);
    }
    entry.triangleCount++;
    const momentKnmPerM = plateCentroidMoments[triangleIndex];
    entry.centroidMoments!.push({ triangleIndex: triangleIndex + 1,
      nodeIds: triangle.nodeIds, momentKnmPerM });
    for (let axis = 0; axis < 3; axis++) {
      entry.maxAbsMomentKnmPerM![axis] = Math.max(entry.maxAbsMomentKnmPerM![axis], Math.abs(momentKnmPerM[axis]));
    }
    for (const nodeId of triangle.nodeIds) {
      const displacement = displacementById.get(nodeId);
      if (!displacement) throw new Error(`DKT-plaat ${triangle.plateId}: knoop ${nodeId} ontbreekt in de Rust-uitvoer.`);
      entry.maxAbsWm = Math.max(entry.maxAbsWm, Math.abs(displacement.uz));
      entry.maxAbsRotationRad = Math.max(entry.maxAbsRotationRad, Math.hypot(displacement.rx, displacement.ry));
    }
  }
  const elements: NonNullable<Frame3DSolveResult["volume3D"]>["elements"] = [
    ...tets.map((tet, index) => {
      const stressMpa = native.solidElementStressMpa[index];
      if (!finiteStress(stressMpa)) throw new Error(`Tet4 ${tet.id}: ongeldige volume-spanning.`);
      return { elementId: tet.id, kind: "tet4" as const, stressMpa, vonMisesMpa: vonMises(stressMpa) };
    }),
    ...hexes.map((hex, index) => {
      const gaussStressMpa = native.hexGaussStressMpa[index];
      if (!Array.isArray(gaussStressMpa) || gaussStressMpa.length !== 8 || !gaussStressMpa.every(finiteStress)) {
        throw new Error(`Hex8 ${hex.id}: ongeldige Gauss-spanningen.`);
      }
      const stressMpa = Array.from({ length: 6 }, (_, component) =>
        gaussStressMpa.reduce((sum, point) => sum + point[component], 0) / 8) as Stress;
      return { elementId: hex.id, kind: "hex8" as const, stressMpa, gaussStressMpa,
        vonMisesMpa: Math.max(...gaussStressMpa.map(vonMises)) };
    }),
  ];
  const membraneResults = membranes.map((plate, index) => {
    const stressMpa = native.membraneStressMpa?.[index];
    const resultantsKnPerM = native.membraneResultantsKnPerM?.[index];
    if (!finiteTriplet(stressMpa) || !finiteTriplet(resultantsKnPerM)) {
      throw new Error(`Tri3-membraan ${plate.id}: ongeldige Rust-spanningen of normaalkrachten.`);
    }
    return { plateId: plate.id, stressMpa, resultantsKnPerM };
  });
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const frameIndexById = new Map(bendingBeams.map((beam, index) => [beam.id, index]));
  const trussIndexById = new Map(axialBeams.map((beam, index) => [beam.id, index]));
  const memberForces = model.beams.map((beam) => {
    const start = nodeById.get(beam.startNodeId), end = nodeById.get(beam.endNodeId);
    if (!start || !end) throw new Error(`Staaf ${beam.id}: ontbrekende eindknoop.`);
    const lengthM = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
    if (beam.axialOnly) {
      const force = native.trussAxialForceKn[trussIndexById.get(beam.id)!];
      return { memberId: beam.id, lengthM, nStartKn: force, nEndKn: force,
        vyStartKn: 0, vyEndKn: 0, vzStartKn: 0, vzEndKn: 0,
        torsionStartKnm: 0, torsionEndKnm: 0, myStartKnm: 0, myEndKnm: 0,
        mzStartKnm: 0, mzEndKnm: 0 };
    }
    const forces = native.frameEndForcesLocal[frameIndexById.get(beam.id)!];
    if (!Array.isArray(forces) || forces.length !== 2
        || forces.some((entry) => !Array.isArray(entry) || entry.length !== 6 || entry.some((value) => !Number.isFinite(value)))) {
      throw new Error(`Staaf ${beam.id}: ongeldige eindkrachten uit de gemengde Rust-kern.`);
    }
    const a = forces[0];
    const b = forces[1];
    return { memberId: beam.id, lengthM,
      nStartKn: -a[0], nEndKn: b[0], vyStartKn: a[1], vyEndKn: -b[1],
      vzStartKn: a[2], vzEndKn: -b[2], torsionStartKnm: a[3], torsionEndKnm: -b[3],
      myStartKnm: a[4], myEndKnm: -b[4], mzStartKnm: a[5], mzEndKnm: -b[5] };
  });
  const force: Vector3 = [0, 0, 0], moment: Vector3 = [0, 0, 0];
  let scaleForce = 0, scaleMoment = 0;
  nodes.forEach((node, index) => {
    const load = loadsKn[index];
    const reaction = native.nodalReactionsKn[index];
    const couple = momentsKnm[index];
    const reactionCouple = reactionMoments[index] ?? [0, 0, 0];
    const armLoad = cross([node.x, node.y, node.z], load);
    const armReaction = cross([node.x, node.y, node.z], reaction);
    for (let axis = 0; axis < 3; axis++) {
      force[axis] += load[axis] + reaction[axis];
      moment[axis] += couple[axis] + reactionCouple[axis] + armLoad[axis] + armReaction[axis];
      scaleForce += Math.abs(load[axis]) + Math.abs(reaction[axis]);
      scaleMoment += Math.abs(couple[axis]) + Math.abs(reactionCouple[axis])
        + Math.abs(armLoad[axis]) + Math.abs(armReaction[axis]);
    }
  });
  const maxImbalanceKn = Math.max(...force.map(Math.abs));
  const maxMomentImbalanceKnm = Math.max(...moment.map(Math.abs));
  const toleranceKn = Math.max(1e-7, scaleForce * 1e-6);
  const momentToleranceKnm = Math.max(1e-7, scaleMoment * 1e-6);
  const ok = maxImbalanceKn <= toleranceKn && maxMomentImbalanceKnm <= momentToleranceKnm;
  return {
    schemaVersion: 1,
    engine: { id: "openaec-native-fem", name: "Open FEM Rust", revision: "0.1.0", license: "AGPL-3.0-or-later" },
    analysis: "linear", displacements, reactions, memberForces,
    diagrams: frame3DVolumeMemberDiagrams(memberForces,
      (model.memberLoads ?? []).map((load) => ({ load,
        factor: factorFor(selection, frame3DLoadCaseId(load)) })).filter(({ factor }) => factor !== 0),
      (model.memberPointLoads ?? []).map((load) => ({ load,
        factor: factorFor(selection, frame3DLoadCaseId(load)) })).filter(({ factor }) => factor !== 0)),
    volume3D: { elements, membranes: membraneResults,
      bendingPlates: bendingPlates.map((plate) => bendingResultByPlate.get(plate.id)!),
      backendUsed: native.backendUsed,
      linearIterations: native.linearIterations, relativeResidual: native.relativeResidual },
    buckling: { status: "notApplicable", reason: "Eigenknik voor gekoppelde volume-raamwerkmodellen is nog niet beschikbaar." },
    equilibrium: { relativeResidual: native.relativeResidual, residualOk: native.relativeResidual <= 1e-8,
      maxImbalanceKn, equilibriumOk: ok && native.relativeResidual <= 1e-8 },
    forceBalance: { imbalanceKn: force, maxImbalanceKn, toleranceKn, momentImbalanceKnm: moment,
      maxMomentImbalanceKnm, momentToleranceKnm, ok },
    solverPath: `native-rust-mixed3d-${native.backendUsed}`,
    diagnostics: [
      `Open FEM Rust: ${tets.length} Tet4, ${hexes.length} Hex8, ${membranes.length} Tri3-membranen, ${bendingTriangles.length} XY-DKT-buigdriehoeken, ${axialBeams.length} trekstaven en ${bendingBeams.length} raamstaven op gedeelde knopen.`,
      `Lineair klein-vervormd; ${native.backendUsed}; relatieve residu ${native.relativeResidual.toExponential(3)}.`,
      ...(bendingTriangles.length > 0 ? ["Gekoppelde XY-DKT-platen dragen alleen buiging en globale z-druk; elastische globale XY-centroïdemomenten per driehoek. Geen plaatmembraan, dwarskrachtresultanten, oppervlaktespanning of constructieve plaattoetsing."] : []),
      ...(volumes.length > 0 ? ["Volume-spanningen: Tet4 constant per element; Hex8 op acht Gauss-punten. Constructieve toetsing van volume-elementen is nog niet beschikbaar."] : []),
    ],
  };
}

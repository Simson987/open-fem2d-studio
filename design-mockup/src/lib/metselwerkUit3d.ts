/**
 * Koppeling metselwerkwand in 3D (#97) → metselwerktoets (#98).
 *
 * Wat het 3D-resultaat levert voor het formulier van de metselwerktoets
 * (NEN-EN 1996-1-1):
 *  - geometrie: t (mm), h en l (m) van de wandplaat;
 *  - verticale belasting per meter (§6.1.2): n_yy uit de wandplaat (y is
 *    omhoog), druk positief. Per niveau (boven, midden, onder) wordt de rij
 *    elementen genomen die het dichtst bij dat niveau ligt. Daaruit komt het
 *    element met de grootste druk, met zijn eigen m_yy als moment uit het vlak.
 *    Het eerste element boven de voet ligt een halve elementhoogte boven de
 *    voet. N onder mist daardoor het gewicht van die halve rij; dat staat in de
 *    meldingen.
 *  - geconcentreerde last onder een latei (§6.1.3): de grootste dwarskracht
 *    in de lateistaaf (rekenwaarde uit het gekozen resultaat). Het rekenmodel
 *    draagt de volle hoogte (zie openFem3dMetselwerkwand). Met het standaardnet
 *    kan die dwarskracht tot ca. 8 % te laag uitvallen
 *    (test-open-fem3d-metselwerkwand.mjs [4]); ook dat staat in de meldingen.
 *    l_b = de opleglengte, b = t, a_1 = de afstand van het wandeinde tot de
 *    oplegging, h_c = de hoogte van de oplegging, e = 0.
 *
 * Alle waarden zijn rekenwaarden van het gekozen 3D-resultaat (geval of
 * combinatie); dit module factoriseert niets.
 */
import type { OpenFem3DModel } from "../components/openFem3d/openFem3dModel";
import type { OpenFem3DSolveResult } from "../components/openFem3d/openFem3dSolver";
import { openFem3DOpeningGeometry, openFem3DWallCoordinates, openFem3DWallFrame } from "../components/openFem3d/openFem3dMetselwerkwand";
import type { MetselwerkFormulier } from "./metselwerkCheckBuilder";

export interface MetselwerkUit3d {
  formulier: Partial<MetselwerkFormulier>;
  /** Per latei een geconcentreerde last (het formulier kent er één; de grootste staat in `formulier`). */
  lateien: { openingId: number; beamId: number; nEdcKn: number; lBMm: number; a1Mm: number; hCM: number }[];
  /** De gebruikte elementrijen: N (kN/m, druk positief), M (kNm/m) en de hoogte z van de rij (m). */
  niveaus: Record<"boven" | "midden" | "onder", { n: number; m: number; z: number }>;
  meldingen: string[];
}

const getal = (v: number, decimalen = 2) => String(Number(v.toFixed(decimalen)));

export function metselwerkUit3d(model: OpenFem3DModel, plateId: number, result: OpenFem3DSolveResult): MetselwerkUit3d {
  const plate = (model.plates ?? []).find((item) => item.id === plateId);
  if (!plate) throw new Error(`3D-plaat ${plateId} bestaat niet.`);
  if (!plate.masonry) throw new Error(`3D-plaat ${plateId} is geen metselwerkwand.`);
  const frame = openFem3DWallFrame(model, plate);
  const byId = new Map(model.nodes.map((node) => [node.id, node]));
  const outline = plate.nodeIds.map((id) => {
    const node = byId.get(id)!;
    return openFem3DWallCoordinates(frame, [node.x, node.y, node.z]);
  });
  const sMin = Math.min(...outline.map((p) => p[0])), sMax = Math.max(...outline.map((p) => p[0]));
  const zMin = Math.min(...outline.map((p) => p[1])), zMax = Math.max(...outline.map((p) => p[1]));
  const meldingen: string[] = [];
  const elementen = (result.shellElements ?? []).filter((element) => element.plateId === plateId);
  if (elementen.length === 0) throw new Error(`Het 3D-resultaat bevat geen plaatelementen van wand ${plateId}.`);

  // Per niveau een strook van één elementgrootte (standaard 0,1 m) aan de
  // kop, rond het midden en aan de voet. Het net rond een opening bestaat uit
  // driehoeken die in vierhoeken gesplitst zijn: daar liggen geen nette rijen.
  const strook = plate.meshSizeM ?? 0.1;
  const niveau = (van: number, tot: number) => {
    const inStrook = elementen.filter((element) => element.centroidM[2] >= van - 1e-9 && element.centroidM[2] <= tot + 1e-9);
    const kandidaten = inStrook.length > 0 ? inStrook : elementen;
    const maatgevend = kandidaten.reduce((best, element) => element.nyyKnPerM < best.nyyKnPerM ? element : best, kandidaten[0]!);
    return { n: -maatgevend.nyyKnPerM, m: Math.abs(maatgevend.myyKnmPerM), z: maatgevend.centroidM[2] };
  };
  const zMid = (zMin + zMax) / 2;
  const boven = niveau(zMax - strook, zMax), midden = niveau(zMid - strook / 2, zMid + strook / 2), onder = niveau(zMin, zMin + strook);
  meldingen.push(`N en M per niveau: het element met de grootste druk in een strook van ${getal(strook, 3)} m (z = ${getal(boven.z, 3)}, ${getal(midden.z, 3)} en ${getal(onder.z, 3)} m; wand ${getal(zMin, 3)}–${getal(zMax, 3)} m). Onder mist zo het gewicht onder het elementmidden.`);
  if ([boven, midden, onder].some((item) => item.n <= 0)) meldingen.push("Op een niveau staat de wand niet op druk (N ≤ 0): de toets weigert dat niveau.");

  const lateien: MetselwerkUit3d["lateien"] = [];
  for (const opening of plate.openings ?? []) {
    if (!opening.lintel) continue;
    const g = openFem3DOpeningGeometry(model, plate, opening);
    const v = [...(result.diagrams?.shearY ?? []), ...(result.diagrams?.shearZ ?? [])]
      .filter((diagram) => diagram.memberId === opening.lintel!.beamId)
      .reduce((max, diagram) => Math.max(max, diagram.maxAbsValue), 0);
    const b = opening.lintel.bearingM;
    lateien.push({
      openingId: opening.id, beamId: opening.lintel.beamId, nEdcKn: v, lBMm: b * 1000,
      a1Mm: Math.max(0, Math.min(g.sMin - b - sMin, sMax - (g.sMax + b))) * 1000, hCM: g.zTop - zMin,
    });
  }
  if (lateien.length > 0) {
    meldingen.push("Lateioplegging: de grootste dwarskracht in de lateistaaf (rekenmodel met volle hoogte). Met het standaardnet kan die tot ca. 8 % te laag zijn; verfijn het net (elementgrootte) bij twijfel.");
  }
  const latei = lateien.reduce<MetselwerkUit3d["lateien"][number] | undefined>((max, item) => !max || item.nEdcKn > max.nEdcKn ? item : max, undefined);
  const formulier: Partial<MetselwerkFormulier> = {
    naam: `3D-wand ${plateId}`,
    t: getal(plate.thicknessM * 1000, 1), h: getal(zMax - zMin, 3), l: getal(sMax - sMin, 3),
    metVerticaal: true,
    nBoven: getal(boven.n), mBoven: getal(boven.m, 3),
    nMidden: getal(midden.n), mMidden: getal(midden.m, 3),
    nOnder: getal(onder.n), mOnder: getal(onder.m, 3),
    ...(latei ? {
      metGeconcentreerd: true, lastNaam: `Latei S${latei.beamId}`, nEdc: getal(latei.nEdcKn), lB: getal(latei.lBMm, 0),
      b: getal(plate.thicknessM * 1000, 1), a1: getal(latei.a1Mm, 0), hC: getal(latei.hCM, 3), e: "0",
    } : {}),
  };
  return { formulier, lateien, meldingen, niveaus: { boven, midden, onder } };
}

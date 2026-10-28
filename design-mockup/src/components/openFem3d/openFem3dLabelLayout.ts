/**
 * openFem3dLabelLayout.ts — de botsingsregel van de labels op het 3D-tekenvlak.
 * Zuiver (geen DOM, geen Three): rechthoeken in schermpixels erin, per label
 * zichtbaar of niet (en een eventuele verschuiving) eruit.
 *
 * DE REGEL. Labels komen aan de beurt op prioriteit (laag eerst), bij gelijke
 * prioriteit in hun eigen volgorde. Een label dat helemaal buiten het beeld
 * valt, of een gereserveerd gebied (bediening: view cube, legenda, kop, …) of
 * een eerder geplaatst label raakt (met 2 px marge), wordt verborgen. Een label
 * met uitwijkplaatsen (verticale verschuivingen in px) probeert die op volgorde
 * voordat het verborgen wordt; de kwartpuntlabels van stand 5 (issue #95)
 * wijken zo een regel omlaag of omhoog uit als hun plek bezet is.
 *
 * Gebruikt door renderOpenFem3DLabels (gemeten rechthoeken) en door het
 * uitdunnen van grote labellagen (geschatte rechthoeken), zie ThreeFrameCanvas.
 */

export interface OpenFem3DLabelRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface OpenFem3DLabelCandidate {
  rect: OpenFem3DLabelRect;
  /** Lager = eerder aan de beurt (wint een botsing). */
  priority: number;
  /** Verticale uitwijkplaatsen in px, op volgorde geprobeerd als de eigen plek bezet is. */
  shifts?: readonly number[];
}

export interface OpenFem3DLabelPlacement {
  shown: boolean;
  /** De verticale verschuiving (px) waarmee het label getoond wordt; 0 = op zijn plek. */
  shift: number;
}

/** De marge tussen twee labels (px). */
export const OPEN_FEM_3D_LABEL_GAP = 2;

export function openFem3DLabelsOverlap(a: OpenFem3DLabelRect, b: OpenFem3DLabelRect): boolean {
  return a.left < b.right + OPEN_FEM_3D_LABEL_GAP && a.right > b.left - OPEN_FEM_3D_LABEL_GAP
    && a.top < b.bottom + OPEN_FEM_3D_LABEL_GAP && a.bottom > b.top - OPEN_FEM_3D_LABEL_GAP;
}

function outside(rect: OpenFem3DLabelRect, viewport: OpenFem3DLabelRect): boolean {
  return rect.right <= viewport.left || rect.left >= viewport.right
    || rect.bottom <= viewport.top || rect.top >= viewport.bottom;
}

const shifted = (rect: OpenFem3DLabelRect, dy: number): OpenFem3DLabelRect =>
  ({ left: rect.left, right: rect.right, top: rect.top + dy, bottom: rect.bottom + dy });

/** Cellen van het zoekrooster voor geplaatste labels (px); alleen voor de snelheid. */
const CELL = 64;

/**
 * Plaats de labels; het resultaat staat in de volgorde van de invoer. Het
 * rooster van geplaatste rechthoeken verandert de uitkomst niet, alleen de
 * snelheid bij duizenden labels.
 */
export function placeOpenFem3DLabels(
  candidates: readonly OpenFem3DLabelCandidate[],
  reserved: readonly OpenFem3DLabelRect[],
  viewport: OpenFem3DLabelRect,
): OpenFem3DLabelPlacement[] {
  const result: OpenFem3DLabelPlacement[] = candidates.map(() => ({ shown: false, shift: 0 }));
  const order = candidates.map((_, index) => index)
    .sort((a, b) => candidates[a].priority - candidates[b].priority || a - b);
  const grid = new Map<number, OpenFem3DLabelRect[]>();
  const cells = (rect: OpenFem3DLabelRect, visit: (key: number) => boolean | void): boolean => {
    const x0 = Math.floor((rect.left - OPEN_FEM_3D_LABEL_GAP) / CELL), x1 = Math.floor((rect.right + OPEN_FEM_3D_LABEL_GAP) / CELL);
    const y0 = Math.floor((rect.top - OPEN_FEM_3D_LABEL_GAP) / CELL), y1 = Math.floor((rect.bottom + OPEN_FEM_3D_LABEL_GAP) / CELL);
    for (let x = x0; x <= x1; x += 1) {
      for (let y = y0; y <= y1; y += 1) if (visit((x + 32768) * 65536 + (y + 32768))) return true;
    }
    return false;
  };
  const free = (rect: OpenFem3DLabelRect) => !reserved.some((other) => openFem3DLabelsOverlap(rect, other))
    && !cells(rect, (key) => grid.get(key)?.some((other) => openFem3DLabelsOverlap(rect, other)));
  const accept = (rect: OpenFem3DLabelRect) => {
    cells(rect, (key) => {
      const list = grid.get(key);
      if (list) list.push(rect); else grid.set(key, [rect]);
    });
  };
  for (const index of order) {
    const { rect, shifts } = candidates[index];
    if (outside(rect, viewport)) continue;
    if (free(rect)) {
      accept(rect);
      result[index] = { shown: true, shift: 0 };
      continue;
    }
    for (const dy of shifts ?? []) {
      const moved = shifted(rect, dy);
      if (outside(moved, viewport) || !free(moved)) continue;
      accept(moved);
      result[index] = { shown: true, shift: dy };
      break;
    }
  }
  return result;
}

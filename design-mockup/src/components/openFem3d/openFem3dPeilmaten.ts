/**
 * Peilmaten bij de levels in 3D (issue #92).
 *
 * Een level is een horizontale stramienas (`StructuralGrid.zAxes`, hoogte in
 * mm). Het 3D-tekenvlak toont per level:
 *  - de stippelrechthoek rond model en stramien, alleen met het stramien
 *    zichtbaar (`structuralGrid` en het stramien in het model aan);
 *  - de PEILMAAT, met de eigen schakelaar `levelMarks`, los van het stramien:
 *    het peildriehoekje (de punt op een kort horizontaal streepje op de
 *    levelhoogte) met de tekst van 2D: `niveauLabel` uit lib/peilmaat.ts
 *    ("1e verdieping  +3,50 m", het nulniveau "±0,00 m", een automatisch
 *    volgnummer niet). Geen tweede notatie.
 *
 * PLAATS. De peilmaat hangt aan een hoek van de RAND van het model: de
 * begrenzing van de knopen in x en y, met de marge van passend beeld voor
 * knoopbol en profiel (`sceneBounds` in ThreeFrameCanvas), op de levelhoogte.
 * Welke van de vier hoeken hangt af van de camera: bij elke labelindeling de
 * hoek die op het scherm het meest links ligt, bij gelijke stand (parallelle
 * projectie) de hoek het dichtst bij de camera (`openFem3DPeilmaatHoek`).
 * Vanaf die hoek lopen streepje, driehoekje en tekst naar links, dus van het
 * model af: in elke kijkrichting buiten het model, nooit over staven. Een
 * vaste hoek (xMin, yMin) kan dat niet: in het zijaanzicht (camera op +x)
 * ligt die hoek het verst weg en valt hij in perspectief binnen het silhouet.
 *
 * Het streepje is een vast aantal pixels lang en staat in het label zelf,
 * horizontaal op het scherm. Dat is de projectie van een horizontale lijn op
 * de levelhoogte langs de rechtsas van de camera (met Z omhoog ligt die as
 * horizontaal), ook in perspectief: alle punten van zo'n lijn hebben dezelfde
 * diepte. Een vaste lengte in px houdt de peilmaat bij elk model even groot,
 * en laat passend beeld er precies ruimte voor maken
 * (`openFem3DPeilmaatRuimtePx`, `openFem3DPeilmaatVerschuivingPx`).
 *
 * Zuiver: getallen in meter en pixels, zonder three.js of DOM. Het tekenvlak
 * (ThreeFrameCanvas.tsx) maakt er DOM-labels van; de testbatterij gebruikt
 * dezelfde functies (test-open-fem3d-peilmaten.mjs, en in het echte
 * tekenvlak test-open-fem3d-peilmaten-ui.mjs).
 */
import { niveauLabel, PEIL_DRIEHOEK_HALF_PX } from "../../lib/peilmaat";
import type { GridAxisLine, StructuralGrid } from "../fem/femTypes";
import type { OpenFem3DVisibility } from "./openFem3dVisibility";

/** Een punt in de 3D-werkruimte (m). */
export type OpenFem3DPunt = readonly [number, number, number];

/** Wat een level nodig heeft; een `GridAxisLine` voldoet. */
type Level = Pick<GridAxisLine, "id" | "label" | "position">;

/* ── Maten van het label (px) ─────────────────────────────────────────── */

/** Letterhoogte van de peilmaattekst (px); gelijk aan OpenFem3DEditor.css. */
export const OPEN_FEM_3D_PEILMAAT_FONT_PX = 11;
/** Tekenbreedte (px): monospace, ~0,6 em, zoals PEILMAAT_TEKEN_PX in 2D. */
export const OPEN_FEM_3D_PEILMAAT_TEKEN_PX = OPEN_FEM_3D_PEILMAAT_FONT_PX * 0.6;
/** Lengte van het streepje (px), van de punt van het driehoekje naar de modelkant. */
export const OPEN_FEM_3D_PEILMAAT_STREEP_PX = 20;
/** Vrije ruimte tussen het streepje en de rand van het model (px). */
export const OPEN_FEM_3D_PEILMAAT_AFSTAND_PX = 4;
/** Ruimte tussen tekst en driehoekje (px). */
export const OPEN_FEM_3D_PEILMAAT_TUSSENRUIMTE_PX = 3;
/** Opvulling links en rechts van de tekst, op haar lichte vlak (px). */
export const OPEN_FEM_3D_PEILMAAT_OPVULLING_PX = 3;

/**
 * De punt van het peildriehoekje ten opzichte van het ankerpunt (de hoek van
 * de rand op de levelhoogte), in px op het scherm: links ervan, op dezelfde
 * hoogte. Het streepje loopt van de punt naar rechts tot AFSTAND_PX voor het
 * ankerpunt.
 */
export function openFem3DPeilmaatPuntPx(): { x: number; y: number } {
  return { x: -(OPEN_FEM_3D_PEILMAAT_AFSTAND_PX + OPEN_FEM_3D_PEILMAAT_STREEP_PX), y: 0 };
}

/**
 * Geschatte breedte van het hele label (px), van het ankerpunt tot de linkerkant
 * van de tekst: afstand, streepje met driehoekje, tussenruimte en tekst.
 * Ruim geschat (0,6 em per teken): passend beeld reserveert hiermee.
 */
export function openFem3DPeilmaatBreedtePx(tekst: string): number {
  return OPEN_FEM_3D_PEILMAAT_AFSTAND_PX + OPEN_FEM_3D_PEILMAAT_STREEP_PX + PEIL_DRIEHOEK_HALF_PX
    + OPEN_FEM_3D_PEILMAAT_TUSSENRUIMTE_PX + 2 * OPEN_FEM_3D_PEILMAAT_OPVULLING_PX
    + tekst.length * OPEN_FEM_3D_PEILMAAT_TEKEN_PX;
}

/* ── Kader van het stramien ───────────────────────────────────────────── */

/**
 * Het kader van stramien en levels (m): het uiterste van knopen en assen per
 * richting, plus een marge van max(1 m, 12 % van het bereik). `baseZ` is het
 * eerste level (daar liggen de stramienlijnen), anders de onderkant.
 */
export interface OpenFem3DStramienKader {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  zMin: number;
  zMax: number;
  baseZ: number;
}

export function openFem3DStramienKader(
  nodes: readonly { x: number; y: number; z: number }[],
  grid: Pick<StructuralGrid, "xAxes" | "yAxes" | "zAxes">,
): OpenFem3DStramienKader {
  const range = (
    axes: readonly { position: number }[],
    coordinate: "x" | "y" | "z",
    fallback: [number, number],
  ): [number, number] => {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const axis of axes) {
      const value = axis.position / 1000;
      if (value < min) min = value;
      if (value > max) max = value;
    }
    for (const node of nodes) {
      const value = node[coordinate];
      if (value < min) min = value;
      if (value > max) max = value;
    }
    if (!Number.isFinite(min)) return fallback;
    const margin = Math.max(1, (max - min) * 0.12);
    return [min - margin, max + margin];
  };
  const [xMin, xMax] = range(grid.xAxes, "x", [-5, 5]);
  const [yMin, yMax] = range(grid.yAxes ?? [], "y", [-5, 5]);
  const [zMin, zMax] = range(grid.zAxes, "z", [0, 5]);
  const baseZ = grid.zAxes[0]?.position !== undefined ? grid.zAxes[0].position / 1000 : zMin;
  return { xMin, xMax, yMin, yMax, zMin, zMax, baseZ };
}

/**
 * Dunning van de stramienlabels en peilmaten: tot 80 elk, daarboven elke n-de
 * (n = ceil(aantal / 40)). Honderden DOM-labels boven op elkaar vertragen
 * pannen en zoomen zonder nog leesbare informatie te geven.
 */
export function openFem3DLabelStride(count: number): number {
  return count <= 80 ? 1 : Math.ceil(count / 40);
}

/** De stippelrechthoek van een level: de vier hoeken op de levelhoogte. */
export interface OpenFem3DLevelRechthoek {
  levelId: string;
  /** Hoogte (m). */
  z: number;
  /** (xMin, yMin), (xMax, yMin), (xMax, yMax), (xMin, yMax). */
  hoeken: readonly [OpenFem3DPunt, OpenFem3DPunt, OpenFem3DPunt, OpenFem3DPunt];
}

/** Alle levelrechthoeken; niet gedund (het zijn lijnen, geen tekst). */
export function openFem3DLevelRechthoeken(levels: readonly Level[], kader: OpenFem3DStramienKader): OpenFem3DLevelRechthoek[] {
  const { xMin, xMax, yMin, yMax } = kader;
  return levels.map((level) => {
    const z = level.position / 1000;
    return {
      levelId: level.id, z,
      hoeken: [[xMin, yMin, z], [xMax, yMin, z], [xMax, yMax, z], [xMin, yMax, z]],
    };
  });
}

/* ── Peilmaten ────────────────────────────────────────────────────────── */

/** De rand van het model in x en y (m), waaraan de peilmaten hangen. */
export interface OpenFem3DPeilmaatRand {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

/**
 * De rand: de begrenzing van het model (knopen met de marge van passend beeld),
 * of, zonder knopen, het stramienkader. Zo hangt de peilmaat vlak naast het
 * model en valt hij na passend beeld in beeld; het kader ligt bij een groot
 * model metres verder (marge max(1 m, 12 %)).
 */
export function openFem3DPeilmaatRand(
  model: OpenFem3DPeilmaatRand | null,
  kader: OpenFem3DStramienKader,
): OpenFem3DPeilmaatRand {
  const geldig = model !== null && [model.xMin, model.xMax, model.yMin, model.yMax].every(Number.isFinite)
    && model.xMin <= model.xMax && model.yMin <= model.yMax;
  const bron = geldig ? model : kader;
  return { xMin: bron.xMin, xMax: bron.xMax, yMin: bron.yMin, yMax: bron.yMax };
}

/** De peilmaat van een level. */
export interface OpenFem3DPeilmaat {
  levelId: string;
  /** De tekst naast het driehoekje, zoals in 2D (`niveauLabel`). */
  tekst: string;
  /** Hoogte (m). */
  z: number;
  /**
   * De vier hoeken van de rand op de levelhoogte, in de volgorde van de
   * levelrechthoek: (xMin, yMin), (xMax, yMin), (xMax, yMax), (xMin, yMax).
   * Het tekenvlak hangt de peilmaat aan één ervan (`openFem3DPeilmaatHoek`).
   */
  hoeken: readonly [OpenFem3DPunt, OpenFem3DPunt, OpenFem3DPunt, OpenFem3DPunt];
}

/** De peilmaten, gedund zoals de stramienlabels (`openFem3DLabelStride`). */
export function openFem3DPeilmaten(levels: readonly Level[], rand: OpenFem3DPeilmaatRand): OpenFem3DPeilmaat[] {
  const stride = openFem3DLabelStride(levels.length);
  const { xMin, xMax, yMin, yMax } = rand;
  const result: OpenFem3DPeilmaat[] = [];
  levels.forEach((level, index) => {
    if (index % stride !== 0) return;
    const z = level.position / 1000;
    result.push({
      levelId: level.id, tekst: niveauLabel(level.label, level.position), z,
      hoeken: [[xMin, yMin, z], [xMax, yMin, z], [xMax, yMax, z], [xMin, yMax, z]],
    });
  });
  return result;
}

/** Een punt op het scherm: x naar rechts (elke eenheid), diepte vanaf de camera (> 0). */
export interface OpenFem3DSchermPunt {
  x: number;
  diepte: number;
}

/**
 * De hoek waaraan de peilmaat hangt (index in `hoeken`): de hoek die op het
 * scherm het meest links ligt; liggen er twee even ver links (parallelle
 * projectie, recht van voren of opzij), dan de dichtstbijzijnde. Een hoek
 * achter de camera (`projecteer` geeft null) telt niet mee; ligt alles erachter,
 * dan de eerste hoek.
 */
export function openFem3DPeilmaatHoek(
  hoeken: readonly OpenFem3DPunt[],
  projecteer: (punt: OpenFem3DPunt) => OpenFem3DSchermPunt | null,
  tolerantie = 1e-6,
): number {
  let beste = -1;
  let besteX = Number.POSITIVE_INFINITY;
  let besteDiepte = Number.POSITIVE_INFINITY;
  hoeken.forEach((hoek, index) => {
    const punt = projecteer(hoek);
    if (!punt || !Number.isFinite(punt.x) || !(punt.diepte > 0)) return;
    const linkser = punt.x < besteX - tolerantie;
    const gelijk = Math.abs(punt.x - besteX) <= tolerantie;
    if (linkser || (gelijk && punt.diepte < besteDiepte)) {
      beste = index;
      besteX = punt.x;
      besteDiepte = punt.diepte;
    }
  });
  return beste < 0 ? 0 : beste;
}

/**
 * Hoeveel ruimte (px) de peilmaten links van het model vragen: het breedste
 * label. Geen peilmaten: 0.
 */
export function openFem3DPeilmaatRuimtePx(peilmaten: readonly Pick<OpenFem3DPeilmaat, "tekst">[]): number {
  return peilmaten.reduce((max, { tekst }) => Math.max(max, openFem3DPeilmaatBreedtePx(tekst)), 0);
}

/**
 * Het deel van de beeldbreedte dat passend beeld met peilmaten mag vullen:
 * het gewone bruikbare deel (`basisBreedte`, met een vrije rand aan elke
 * zijde) min de ruimte voor de peilmaten, hooguit 40 % ervan.
 */
export function openFem3DPeilmaatBruikbareBreedte(basisBreedte: number, beeldBreedtePx: number, ruimtePx: number): number {
  return basisBreedte - Math.min(Math.max(0, ruimtePx) / Math.max(beeldBreedtePx, 1), 0.4 * basisBreedte);
}

/**
 * Hoeveel px passend beeld het model naar rechts schuift om de peilmaten links
 * ruimte te geven. Na het passen staat het model in het midden, met
 * `vrij` = breedte/2 − halve modelbreedte aan elke kant. Links is de gewone
 * vrije rand plus `ruimtePx` nodig, rechts alleen de vrije rand; de rand is
 * (1 − basisBreedte)/2 van het beeld (zie usableViewport). Niet meer schuiven
 * dan rechts toelaat; past het al, dan niet.
 */
export function openFem3DPeilmaatVerschuivingPx(
  beeldBreedtePx: number,
  basisBreedte: number,
  modelHalfPx: number,
  ruimtePx: number,
): number {
  if (!(ruimtePx > 0)) return 0;
  const rand = beeldBreedtePx * (1 - basisBreedte) / 2;
  const vrij = beeldBreedtePx / 2 - modelHalfPx;
  return Math.min(Math.max(0, rand + ruimtePx - vrij), Math.max(0, vrij - rand));
}

/* ── Zichtbaarheid ────────────────────────────────────────────────────── */

/** Wat er bij de levels zichtbaar is. */
export interface OpenFem3DLevelZicht {
  /** De stippelrechthoeken (met de rest van het stramien). */
  stramien: boolean;
  /** De peilmaten. */
  peilmaten: boolean;
}

/**
 * Het stramien vraagt de weergave `structuralGrid` én het stramien in het
 * model (`enabled`); de peilmaten alleen `levelMarks`. Peilmaten zijn
 * modelinformatie en blijven dus staan als het stramien uit is.
 */
export function openFem3DLevelZichtbaarheid(
  visibility: Pick<OpenFem3DVisibility, "structuralGrid" | "levelMarks">,
  grid: Pick<StructuralGrid, "enabled"> | undefined,
): OpenFem3DLevelZicht {
  return {
    stramien: !!grid && grid.enabled && visibility.structuralGrid,
    peilmaten: !!grid && visibility.levelMarks,
  };
}

/** Rechthoeken en peilmaten samen, volgens wat er zichtbaar is. */
export function openFem3DLevelWeergave(
  levels: readonly Level[],
  kader: OpenFem3DStramienKader,
  rand: OpenFem3DPeilmaatRand,
  zicht: OpenFem3DLevelZicht,
): { rechthoeken: OpenFem3DLevelRechthoek[]; peilmaten: OpenFem3DPeilmaat[] } {
  return {
    rechthoeken: zicht.stramien ? openFem3DLevelRechthoeken(levels, kader) : [],
    peilmaten: zicht.peilmaten ? openFem3DPeilmaten(levels, rand) : [],
  };
}

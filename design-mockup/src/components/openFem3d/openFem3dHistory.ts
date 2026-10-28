import type { OpenFem3DModel } from "./openFem3dModel";
import { changedLockedOpenFem3DLayer } from "./openFem3dLayers";
import type { OpenFem3DLevelPatch, OpenFem3DLevelTransition } from "./openFem3dLevels";

/**
 * Een wijziging buiten het 3D-model die bij dezelfde stap hoort, zoals de
 * belastinggevallen in de raamwerkstore bij het verwijderen van een geval
 * (#91). `terug` hoort bij undo, `vooruit` bij redo.
 */
export interface OpenFem3DExternStap {
  terug: () => void;
  vooruit: () => void;
}

export interface OpenFem3DHistory {
  model: OpenFem3DModel;
  past: OpenFem3DModel[];
  future: OpenFem3DModel[];
  activeGroup?: string;
  /**
   * De levelwijziging die bij elke stap hoort, index voor index gelijk aan
   * `past` (de stap van `past[i]` naar het volgende model) en `future` (de stap
   * náár `future[i]`). null = een stap die alleen het model wijzigde.
   * Ontbreekt bij een geschiedenis zonder levelstappen.
   *
   * De levels zelf staan in het stramien van de raamwerkstore, niet in het
   * 3D-model. Een nieuwe levelhoogte met de knopen die meeschuiven is toch één
   * stap: de aanroeper leest vóór undo/redo met `openFem3DHistoryLevelPatch`
   * welke levelstand terug moet en zet die in het stramien.
   */
  pastLevels?: (OpenFem3DLevelTransition | null)[];
  futureLevels?: (OpenFem3DLevelTransition | null)[];
  /**
   * De externe wijziging per stap, op dezelfde manier uitgelijnd als de
   * levels. De aanroeper leest vóór undo/redo met `openFem3DHistoryExtern`
   * welke actie erbij hoort en voert die uit.
   */
  pastExtern?: (OpenFem3DExternStap | null)[];
  futureExtern?: (OpenFem3DExternStap | null)[];
}

export interface OpenFem3DEditMeta {
  /** All edits made while drawing one contour share one undo step. */
  historyGroup?: string;
  /** A discarded sketch can remove its now empty undo step. */
  cancelHistoryGroup?: boolean;
  /** Een wijziging buiten het model die bij deze stap hoort; nooit samen met een tekengroep. */
  extern?: OpenFem3DExternStap | null;
}

export type OpenFem3DAction =
  | ({ type: "edit"; model: OpenFem3DModel; levels?: OpenFem3DLevelTransition | null;
      /** Explicit whole-model replacement (e.g. the hall wizard) overrides entity locks. */
      ignoreLayerLocks?: boolean } & OpenFem3DEditMeta)
  | { type: "replace"; model: OpenFem3DModel }
  | { type: "undo" | "redo" };

function sameModelContents(a: OpenFem3DModel, b: OpenFem3DModel): boolean {
  const left = a as unknown as Record<string, unknown>;
  const right = b as unknown as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => {
    if (!(key in right)) return false;
    const x = left[key];
    const y = right[key];
    return Array.isArray(x) && Array.isArray(y)
      ? x.length === y.length && x.every((item, index) => item === y[index])
      : x === y;
  });
}

/** Een lijst per stap van `past`, even lang als `past` (ook bij een oude toestand zonder). */
function uitgelijndPast<T>(state: OpenFem3DHistory, lijst: (T | null)[] | undefined): (T | null)[] {
  const items = lijst ?? [];
  const missing = state.past.length - items.length;
  return missing > 0 ? [...Array<null>(missing).fill(null), ...items] : items.slice(-state.past.length || items.length);
}

function uitgelijndFuture<T>(state: OpenFem3DHistory, lijst: (T | null)[] | undefined): (T | null)[] {
  const items = lijst ?? [];
  return state.future.map((_, index) => items[index] ?? null);
}

const pastLevelsOf = (state: OpenFem3DHistory) => uitgelijndPast(state, state.pastLevels);
const futureLevelsOf = (state: OpenFem3DHistory) => uitgelijndFuture(state, state.futureLevels);
const pastExternOf = (state: OpenFem3DHistory) => uitgelijndPast(state, state.pastExtern);
const futureExternOf = (state: OpenFem3DHistory) => uitgelijndFuture(state, state.futureExtern);

/**
 * De levelstand die bij de volgende undo (`before` van de laatste stap) of redo
 * (`after` van de eerstvolgende stap) in het stramien moet komen, of null.
 */
export function openFem3DHistoryLevelPatch(state: OpenFem3DHistory, kind: "undo" | "redo"): OpenFem3DLevelPatch | null {
  if (kind === "undo") {
    if (state.past.length === 0) return null;
    return pastLevelsOf(state)[state.past.length - 1]?.before ?? null;
  }
  if (state.future.length === 0) return null;
  return futureLevelsOf(state)[0]?.after ?? null;
}

/** De externe actie die bij de volgende undo (`terug`) of redo (`vooruit`) hoort, of null. */
export function openFem3DHistoryExtern(state: OpenFem3DHistory, kind: "undo" | "redo"): (() => void) | null {
  if (kind === "undo") {
    if (state.past.length === 0) return null;
    return pastExternOf(state)[state.past.length - 1]?.terug ?? null;
  }
  if (state.future.length === 0) return null;
  return futureExternOf(state)[0]?.vooruit ?? null;
}

export function openFem3dHistoryReducer(state: OpenFem3DHistory, action: OpenFem3DAction): OpenFem3DHistory {
  if (action.type === "replace") return { model: action.model, past: [], future: [] };
  if (action.type === "edit") {
    if (!action.ignoreLayerLocks && changedLockedOpenFem3DLayer(state.model, action.model)) return state;
    const levels = action.levels ?? null;
    const extern = action.extern ?? null;
    // Een levelwijziging zonder gekoppelde knopen, of een gevallenwijziging
    // zonder 3D-lasten, laat het model gelijk, maar is wel een stap.
    if (action.model === state.model && !levels && !extern) return state;
    const pastLevels = pastLevelsOf(state);
    const pastExtern = pastExternOf(state);
    const sameGroup = !levels && !extern && Boolean(action.historyGroup && action.historyGroup === state.activeGroup);
    if (sameGroup && action.cancelHistoryGroup) {
      const beforeSketch = state.past[state.past.length - 1];
      if (beforeSketch && sameModelContents(beforeSketch, action.model)) {
        return {
          model: beforeSketch, past: state.past.slice(0, -1), future: [], activeGroup: undefined,
          pastLevels: pastLevels.slice(0, -1), futureLevels: [],
          pastExtern: pastExtern.slice(0, -1), futureExtern: [],
        };
      }
    }
    if (sameGroup) return { ...state, model: action.model, future: [], futureLevels: [], futureExtern: [] };
    return {
      model: action.model,
      past: [...state.past.slice(-99), state.model],
      future: [],
      activeGroup: levels || extern ? undefined : action.historyGroup,
      pastLevels: [...pastLevels.slice(-99), levels],
      futureLevels: [],
      pastExtern: [...pastExtern.slice(-99), extern],
      futureExtern: [],
    };
  }
  if (action.type === "undo") {
    const previous = state.past[state.past.length - 1];
    if (!previous) return state;
    const pastLevels = pastLevelsOf(state);
    const pastExtern = pastExternOf(state);
    return {
      model: previous,
      past: state.past.slice(0, -1),
      future: [state.model, ...state.future],
      pastLevels: pastLevels.slice(0, -1),
      futureLevels: [pastLevels[pastLevels.length - 1] ?? null, ...futureLevelsOf(state)],
      pastExtern: pastExtern.slice(0, -1),
      futureExtern: [pastExtern[pastExtern.length - 1] ?? null, ...futureExternOf(state)],
    };
  }
  const next = state.future[0];
  if (!next) return state;
  const futureLevels = futureLevelsOf(state);
  const futureExtern = futureExternOf(state);
  return {
    model: next,
    past: [...state.past, state.model],
    future: state.future.slice(1),
    pastLevels: [...pastLevelsOf(state), futureLevels[0] ?? null],
    futureLevels: futureLevels.slice(1),
    pastExtern: [...pastExternOf(state), futureExtern[0] ?? null],
    futureExtern: futureExtern.slice(1),
  };
}

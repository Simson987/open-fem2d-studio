import type { OpenFem3DModel } from "./openFem3dModel";
import type { OpenFem3DLevelPatch, OpenFem3DLevelTransition } from "./openFem3dLevels";

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
}

export interface OpenFem3DEditMeta {
  /** All edits made while drawing one contour share one undo step. */
  historyGroup?: string;
  /** A discarded sketch can remove its now empty undo step. */
  cancelHistoryGroup?: boolean;
}

export type OpenFem3DAction =
  | ({ type: "edit"; model: OpenFem3DModel; levels?: OpenFem3DLevelTransition | null } & OpenFem3DEditMeta)
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

/** De levelstappen van `past`, even lang als `past` (ook bij een oude toestand zonder). */
function pastLevelsOf(state: OpenFem3DHistory): (OpenFem3DLevelTransition | null)[] {
  const levels = state.pastLevels ?? [];
  const missing = state.past.length - levels.length;
  return missing > 0 ? [...Array<null>(missing).fill(null), ...levels] : levels.slice(-state.past.length || levels.length);
}

function futureLevelsOf(state: OpenFem3DHistory): (OpenFem3DLevelTransition | null)[] {
  const levels = state.futureLevels ?? [];
  return state.future.map((_, index) => levels[index] ?? null);
}

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

export function openFem3dHistoryReducer(state: OpenFem3DHistory, action: OpenFem3DAction): OpenFem3DHistory {
  if (action.type === "replace") return { model: action.model, past: [], future: [] };
  if (action.type === "edit") {
    const levels = action.levels ?? null;
    // Een levelwijziging zonder gekoppelde knopen laat het model gelijk, maar
    // is wel een stap: undo zet dan alleen de levelhoogte terug.
    if (action.model === state.model && !levels) return state;
    const pastLevels = pastLevelsOf(state);
    const sameGroup = !levels && Boolean(action.historyGroup && action.historyGroup === state.activeGroup);
    if (sameGroup && action.cancelHistoryGroup) {
      const beforeSketch = state.past[state.past.length - 1];
      if (beforeSketch && sameModelContents(beforeSketch, action.model)) {
        return {
          model: beforeSketch, past: state.past.slice(0, -1), future: [], activeGroup: undefined,
          pastLevels: pastLevels.slice(0, -1), futureLevels: [],
        };
      }
    }
    if (sameGroup) return { ...state, model: action.model, future: [], futureLevels: [] };
    return {
      model: action.model,
      past: [...state.past.slice(-99), state.model],
      future: [],
      activeGroup: levels ? undefined : action.historyGroup,
      pastLevels: [...pastLevels.slice(-99), levels],
      futureLevels: [],
    };
  }
  if (action.type === "undo") {
    const previous = state.past[state.past.length - 1];
    if (!previous) return state;
    const pastLevels = pastLevelsOf(state);
    return {
      model: previous,
      past: state.past.slice(0, -1),
      future: [state.model, ...state.future],
      pastLevels: pastLevels.slice(0, -1),
      futureLevels: [pastLevels[pastLevels.length - 1] ?? null, ...futureLevelsOf(state)],
    };
  }
  const next = state.future[0];
  if (!next) return state;
  const futureLevels = futureLevelsOf(state);
  return {
    model: next,
    past: [...state.past, state.model],
    future: state.future.slice(1),
    pastLevels: [...pastLevelsOf(state), futureLevels[0] ?? null],
    futureLevels: futureLevels.slice(1),
  };
}

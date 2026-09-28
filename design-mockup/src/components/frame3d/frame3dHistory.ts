import type { Frame3DModel } from "./frame3dModel";

export interface Frame3DHistory {
  model: Frame3DModel;
  past: Frame3DModel[];
  future: Frame3DModel[];
  activeGroup?: string;
}

export interface Frame3DEditMeta {
  /** All edits made while drawing one contour share one undo step. */
  historyGroup?: string;
  /** A discarded sketch can remove its now empty undo step. */
  cancelHistoryGroup?: boolean;
}

export type Frame3DAction =
  | ({ type: "edit"; model: Frame3DModel } & Frame3DEditMeta)
  | { type: "replace"; model: Frame3DModel }
  | { type: "undo" | "redo" };

function sameModelContents(a: Frame3DModel, b: Frame3DModel): boolean {
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

export function frame3dHistoryReducer(state: Frame3DHistory, action: Frame3DAction): Frame3DHistory {
  if (action.type === "replace") return { model: action.model, past: [], future: [] };
  if (action.type === "edit") {
    if (action.model === state.model) return state;
    const sameGroup = Boolean(action.historyGroup && action.historyGroup === state.activeGroup);
    if (sameGroup && action.cancelHistoryGroup) {
      const beforeSketch = state.past[state.past.length - 1];
      if (beforeSketch && sameModelContents(beforeSketch, action.model)) {
        return { model: beforeSketch, past: state.past.slice(0, -1), future: [], activeGroup: undefined };
      }
    }
    if (sameGroup) return { ...state, model: action.model, future: [] };
    return {
      model: action.model,
      past: [...state.past.slice(-99), state.model],
      future: [],
      activeGroup: action.historyGroup,
    };
  }
  if (action.type === "undo") {
    const previous = state.past[state.past.length - 1];
    return previous
      ? { model: previous, past: state.past.slice(0, -1), future: [state.model, ...state.future] }
      : state;
  }
  const next = state.future[0];
  return next
    ? { model: next, past: [...state.past, state.model], future: state.future.slice(1) }
    : state;
}

// Undo/redo for editors that hold one immutable value (the label designer's
// template). Pure, so it can be tested without React.
//
// Rapid changes that belong together collapse into one undo step: every
// mousemove of a drag, or each keystroke while typing in the same field.
// Callers pass a `key` naming what changed; consecutive changes with the same
// key within `window` ms merge into the step before.

export type History<T> = {
  past: T[];
  present: T;
  future: T[];
  // What the newest step was about, and when it last changed — for merging.
  lastKey: string | null;
  lastAt: number;
};

const LIMIT = 100;
const MERGE_WINDOW = 1000;

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [], lastKey: null, lastAt: 0 };
}

/**
 * Makes `next` the present value. With the same `key` as the previous change
 * and within `window` ms of it (Infinity for a drag that may pause), it
 * replaces that step instead of adding one. Any redo steps are dropped.
 */
export function record<T>(
  h: History<T>,
  next: T,
  { key = null, at, window = MERGE_WINDOW }: { key?: string | null; at: number; window?: number },
): History<T> {
  if (Object.is(next, h.present)) return h;
  const merge = key !== null && key === h.lastKey && at - h.lastAt <= window;
  return {
    past: merge ? h.past : [...h.past, h.present].slice(-LIMIT),
    present: next,
    future: [],
    lastKey: key,
    lastAt: at,
  };
}

export function undo<T>(h: History<T>): History<T> {
  if (h.past.length === 0) return h;
  return {
    past: h.past.slice(0, -1),
    present: h.past[h.past.length - 1],
    future: [h.present, ...h.future],
    // The next edit starts a fresh step rather than merging into an undone one.
    lastKey: null,
    lastAt: 0,
  };
}

export function redo<T>(h: History<T>): History<T> {
  if (h.future.length === 0) return h;
  return {
    past: [...h.past, h.present],
    present: h.future[0],
    future: h.future.slice(1),
    lastKey: null,
    lastAt: 0,
  };
}

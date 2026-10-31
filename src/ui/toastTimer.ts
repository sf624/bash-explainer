// How long a toast of the web page stays (docs/design/chrome-redesign.md, C3): 4 s, or 8 s when it has a button
// (Undo, More, Why?); the time stops while the pointer is on the toast or the focus in it, and goes on when both have
// left, with at least 2 s more, so that a toast does not vanish the moment the pointer leaves it. The page keeps one
// state per toast and calls these at each event (web/toast.ts); they decide, the page only sets the timeout.

/** A toast with nothing to press stays this long, in milliseconds; one with a button `ACTION_MS`. */
export const PLAIN_MS = 4000;
export const ACTION_MS = 8000;
/** What is left at least when the pointer and the focus leave a held toast. */
export const AFTER_HOLD_MS = 2000;

export interface ToastTimer {
  /** The time left, in milliseconds, counted from `since` while it runs. */
  readonly left: number;
  /** When it last started running; undefined while it is held. */
  readonly since?: number;
}

/** A new toast's timer, running from `now`. */
export function startToast(withButton: boolean, now: number): ToastTimer {
  return { left: withButton ? ACTION_MS : PLAIN_MS, since: now };
}

/** The pointer or the focus came onto the toast: the time stops. */
export function holdToast(t: ToastTimer, now: number): ToastTimer {
  if (t.since === undefined) return t;
  return { left: Math.max(0, t.left - (now - t.since)) };
}

/** Both the pointer and the focus have left: the time goes on, with at least `AFTER_HOLD_MS` left. */
export function releaseToast(t: ToastTimer, now: number): ToastTimer {
  if (t.since !== undefined) return t;
  return { left: Math.max(AFTER_HOLD_MS, t.left), since: now };
}

/** When the toast goes, or undefined while it is held. */
export function toastEnds(t: ToastTimer): number | undefined {
  return t.since === undefined ? undefined : t.since + t.left;
}

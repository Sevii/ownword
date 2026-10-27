// AI review lifecycle (docs/automated-text-review-design.md §4):
// idle → running → validating-output → completed, or failed / cancelled.
// Only a completed review with validated output can be applied, and only
// while its source revision is still current.

/**
 * @typedef {{ status: 'idle'|'running'|'validating-output'|'completed'|'failed'|'cancelled',
 *   clientRequestId: string | null, requestId: string | null, sourceRevision: number | null,
 *   preview: string, result: unknown, error: { error: string, message: string, manageUrl?: string } | null }} ReviewState
 */

/** @type {ReviewState} */
export const INITIAL = {
  status: 'idle', clientRequestId: null, requestId: null, sourceRevision: null, preview: '', result: null, error: null,
};

const FINAL = new Set(['completed', 'failed', 'cancelled']);

/**
 * @param {ReviewState} state
 * @param {{ type: string, [k: string]: any }} action
 * @returns {ReviewState}
 */
export function reviewReducer(state, action) {
  switch (action.type) {
    case 'start':
      return { ...INITIAL, status: 'running', clientRequestId: action.clientRequestId, sourceRevision: action.sourceRevision };
    case 'event': {
      // Late events from an earlier or finished request never change state.
      if (action.clientRequestId !== state.clientRequestId || FINAL.has(state.status)) return state;
      const e = action.event;
      if (e.type === 'started') return { ...state, requestId: e.requestId };
      if (e.type === 'delta') return { ...state, preview: state.preview + e.text };
      if (e.type === 'completed') return { ...state, status: 'validating-output', preview: e.text };
      if (e.type === 'failed') return { ...state, status: 'failed', error: { error: e.error, message: e.message, manageUrl: e.manageUrl } };
      if (e.type === 'cancelled') return { ...state, status: 'cancelled' };
      return state;
    }
    case 'validated':
      if (action.clientRequestId !== state.clientRequestId || state.status !== 'validating-output') return state;
      return action.ok
        ? { ...state, status: 'completed', result: action.result }
        : { ...state, status: 'failed', error: { error: 'invalid-output', message: action.message } };
    case 'cancel':
      return FINAL.has(state.status) ? state : { ...state, status: 'cancelled' };
    case 'reset':
      return INITIAL;
    default:
      return state;
  }
}

/** @param {ReviewState} state @param {number} currentRevision */
export function canApply(state, currentRevision) {
  return state.status === 'completed' && state.sourceRevision === currentRevision && state.result != null;
}

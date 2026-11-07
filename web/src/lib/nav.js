// Browser history with a counter. Each entry the app pushes carries its position
// ({i: n}), so when Back or Forward must be undone (an unsaved note is open) the
// app can step back to where the browser was with history.go(). Pushing a fresh
// entry instead would throw away the Forward entries.

let idx = Number.isInteger(history.state?.i) ? history.state.i : 0;

export function pushRoute(url) {
  idx += 1;
  history.pushState({ i: idx }, '', url);
}

/** For a popstate event: how many entries the browser moved (negative = Back).
 *  0 when the entry carries no position. */
export function moved(state) {
  const to = Number.isInteger(state?.i) ? state.i : 0;
  const d = to - idx;
  idx = to;
  return d;
}

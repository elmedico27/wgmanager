// Page addresses. Pure functions (no app state), shared by the store and App.
//   /                  Clients (the address stays /)
//   /clients           Clients
//   /clients/<name>    Clients with that client's panel open
//   /host, /settings
// Anything else is "page not found". The server answers the same set with the
// app (status 200) and everything else with the app and status 404
// (server/src/http.js isAppRoute); keep the two in step.

/** { view, selected } for a path, or null when it isn't a page of the app. */
export function routeFromPath(pathname) {
  const p = (pathname || '/').replace(/\/+$/, '') || '/';
  if (p === '/' || p === '/index.html' || p === '/clients') return { view: 'clients', selected: null };
  if (p === '/host') return { view: 'host', selected: null };
  if (p === '/settings') return { view: 'settings', selected: null };
  const m = /^\/clients\/([^/]+)$/.exec(p);
  if (m) {
    try {
      return { view: 'clients', selected: decodeURIComponent(m[1]) };
    } catch {
      return null; // malformed %-escape
    }
  }
  return null;
}

export function pathFor(view, selected) {
  if (view === 'clients' && selected) return `/clients/${encodeURIComponent(selected)}`;
  return `/${view}`;
}

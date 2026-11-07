// Client search on the Clients page: case-insensitive substring match on the
// client's name, address and note. Notes are looked up by public key (see
// store.svelte.js, app.notes). The search text itself lives in memory only.

export function normalizeQuery(q) {
  return (q ?? '').trim().toLowerCase();
}

export function matchesClient(c, query, notes) {
  const q = normalizeQuery(query);
  if (!q) return true;
  const note = notes?.[c.public_key] ?? '';
  return [c.name, c.address, note].some((v) => (v ?? '').toLowerCase().includes(q));
}

export function filterClients(clients, query, notes) {
  return normalizeQuery(query) ? clients.filter((c) => matchesClient(c, query, notes)) : clients;
}

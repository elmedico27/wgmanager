// Client sorting, shared by the list and card views (one choice, remembered
// per browser in store.svelte.js).
//
// - Name: case-insensitive, numbers in names compare as numbers (Phone2 < Phone10).
// - Address: numeric IPv4 compare, so 10.0.0.9 < 10.0.0.10.
// - Last handshake, Download, Upload: clients without a value (never
//   handshaked, or not live so no counters) stay at the bottom in either
//   direction. Name and Address have no such rule.
// - Ties fall back to address, then name, so rows don't swap places between
//   refreshes when their values are equal.

export const SORT_KEYS = {
  name: { label: 'Name', firstDir: 'asc' },
  address: { label: 'Address', firstDir: 'asc' },
  handshake: { label: 'Last handshake', firstDir: 'desc' },
  download: { label: 'Download', firstDir: 'desc' },
  upload: { label: 'Upload', firstDir: 'desc' },
};

export const DEFAULT_SORT = { key: 'address', dir: 'asc' };

export function validSort(s) {
  return !!s && Object.hasOwn(SORT_KEYS, s.key) && (s.dir === 'asc' || s.dir === 'desc');
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function ipv4(addr) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\/\d+)?$/.exec(addr ?? '');
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return ((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3];
}

// Download/upload are from the client's point of view: the server's tx is
// the client's download (same mapping as the cards and table).
function value(c, key) {
  switch (key) {
    case 'handshake':
      return c.live && c.latest_handshake ? c.latest_handshake : null;
    case 'download':
      return c.live && c.transfer_tx != null ? c.transfer_tx : null;
    case 'upload':
      return c.live && c.transfer_rx != null ? c.transfer_rx : null;
    default:
      return null;
  }
}

function byAddress(a, b) {
  const x = ipv4(a.address);
  const y = ipv4(b.address);
  if (x === null && y === null) return collator.compare(a.address ?? '', b.address ?? '');
  if (x === null) return 1; // unparsable addresses last
  if (y === null) return -1;
  return x - y;
}

function tieBreak(a, b) {
  return byAddress(a, b) || collator.compare(a.name, b.name) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}

export function sortClients(clients, sort) {
  const { key, dir } = validSort(sort) ? sort : DEFAULT_SORT;
  const sign = dir === 'desc' ? -1 : 1;
  return [...clients].sort((a, b) => {
    if (key === 'name') return sign * (collator.compare(a.name, b.name) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) || tieBreak(a, b);
    if (key === 'address') return sign * byAddress(a, b) || collator.compare(a.name, b.name);
    const x = value(a, key);
    const y = value(b, key);
    if (x === null || y === null) {
      if (x === y) return tieBreak(a, b);
      return x === null ? 1 : -1; // missing values last, whatever the direction
    }
    return sign * (x - y) || tieBreak(a, b);
  });
}

/** Clicking a column header: same column flips direction, a new one starts at its natural direction. */
export function nextSort(current, key) {
  if (current?.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: SORT_KEYS[key].firstDir };
}

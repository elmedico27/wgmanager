// Client notes: free text per client, kept by the app in its data volume
// (`notes.json`), never on the host. Keyed by the client's WireGuard public key,
// which PiVPN never reuses: a client deleted and re-created under the same name
// gets new keys and starts without a note.
//
// File shape: {"notes": {"<public key>": "<text>", ...}}
// Notes for clients removed outside the app (pivpn -r) are kept on purpose:
// deleting data because one `list` didn't show a key would risk real notes.

export const NOTE_MAX = 500; // UTF-16 code units, the same count as the textarea's maxlength
export const NOTES_MAX = 1000; // bounds the file; far more than a PiVPN subnet holds
const FILE = 'notes.json';

// A WireGuard key is 32 bytes in base64: 43 characters and one '='.
const KEY_RE = /^[A-Za-z0-9+/]{43}=$/;
// Line breaks and tabs are fine; other control characters are refused.
const CONTROL_RE = /[\u0000-\u0008\u000b-\u001f\u007f]/;

export function isPublicKey(k) {
  return typeof k === 'string' && KEY_RE.test(k);
}

/** Normalise a note from the UI. Returns {text} ('' means remove) or {problem}. */
export function cleanNote(note) {
  if (typeof note !== 'string') return { problem: 'note must be text' };
  const text = note.replace(/\r\n?/g, '\n').trim();
  if (text.length > NOTE_MAX) return { problem: `note is longer than ${NOTE_MAX} characters` };
  if (CONTROL_RE.test(text)) return { problem: 'note contains control characters' };
  return { text };
}

export class Notes {
  constructor(store, log) {
    this.store = store;
    this.log = log;
    this.warned = false; // the UI polls; say it once, not every 15 s
  }

  /** {notes} or {unreadable: true}. A damaged file is never overwritten. */
  read() {
    try {
      const v = this.store.readJson(FILE);
      if (v === null) return { notes: {} };
      if (!v || typeof v.notes !== 'object' || v.notes === null || Array.isArray(v.notes)) throw new Error('bad shape');
      this.warned = false;
      return { notes: v.notes };
    } catch {
      if (!this.warned) this.log('wgmanager: notes.json is unreadable; notes cannot be changed until it is fixed or removed');
      this.warned = true;
      return { unreadable: true, notes: {} };
    }
  }

  /** Set (or with '' remove) one note. Returns an error code string or null. */
  set(key, text) {
    const cur = this.read();
    if (cur.unreadable) return 'unreadable';
    const notes = { ...cur.notes };
    if (text) {
      if (!(key in notes) && Object.keys(notes).length >= NOTES_MAX) return 'full';
      notes[key] = text;
    } else {
      if (!(key in notes)) return null;
      delete notes[key];
    }
    this.store.writeJson(FILE, { notes });
    return null;
  }
}

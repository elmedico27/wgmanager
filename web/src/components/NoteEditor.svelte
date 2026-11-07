<script>
  // Free-text note for one client, saved by the app (not on the host). The
  // parent remounts this per public key, so a draft never follows you to another client.
  import { untrack } from 'svelte';
  import { app, saveNote, notify } from '../lib/store.svelte.js';
  import { errorText } from '../lib/format.js';

  // The server's limit, counted the same way (UTF-16 units). No maxlength on the
  // box: a paste that runs over stays whole, so you choose what to trim (owner).
  const MAX = 500;

  let { publicKey, name } = $props();

  // Same cleanup the server applies, so trailing spaces alone are not "unsaved".
  const clean = (s) => s.replace(/\r\n?/g, '\n').trim();

  let saved = $derived(app.notes[publicKey] ?? '');
  let draft = $state(untrack(() => saved));
  let saving = $state(false);
  let error = $state(null);
  let dirty = $derived(clean(draft) !== saved);
  let over = $derived(Math.max(0, draft.length - MAX));

  // A save from another browser shows up on the next refresh. Take it, unless
  // you have started editing here.
  let prev = untrack(() => saved);
  $effect(() => {
    const s = saved;
    untrack(() => {
      if (clean(draft) === prev) draft = s;
    });
    prev = s;
  });

  $effect(() => {
    app.noteDirty = dirty;
    return () => (app.noteDirty = false);
  });

  async function save() {
    saving = true;
    error = null;
    const r = await saveNote(publicKey, clean(draft));
    saving = false;
    if (r.ok) {
      draft = r.data.note;
      notify(r.data.note ? `Note saved for ${name}` : `Note removed from ${name}`);
    } else if (r.error.code === 'invalid_request') {
      error = `Not saved: ${r.error.message}.`;
    } else if (r.error.code === 'server_error') {
      error = "Not saved: WG Manager could not write its notes file. See the container's log.";
    } else {
      error = errorText(r.error);
    }
  }
</script>

<section class="flex flex-col gap-3">
  <h3 class="text-sm font-semibold"><label for="note-{name}">Notes</label></h3>
  <div class="flex flex-col gap-2">
    <textarea
      id="note-{name}"
      class="field h-auto! min-h-[5.5rem] resize-y py-2! text-sm leading-relaxed"
      rows="3"
      bind:value={draft}
      disabled={saving}
      aria-invalid={over > 0}
      aria-describedby="note-count-{name}"
    ></textarea>
    <div class="flex items-center justify-between gap-3">
      <button class="btn btn-ghost" onclick={save} disabled={!dirty || over > 0 || saving || app.notesUnreadable}>
        {saving ? 'Saving…' : 'Save'}
      </button>
      <span id="note-count-{name}" class="tabular text-xs {over ? 'font-medium text-off' : 'text-ink-2'}">{draft.length} / {MAX}</span>
    </div>
    {#if over}
      <p class="text-sm text-off" role="status">{over} {over === 1 ? 'character' : 'characters'} over the limit. Shorten the note to save it.</p>
    {/if}
    {#if app.notesUnreadable}
      <p class="text-sm text-off">Notes can't be saved: WG Manager's notes file is damaged. See the container's log.</p>
    {/if}
    {#if error}<p class="text-sm text-off">{error}</p>{/if}
  </div>
</section>

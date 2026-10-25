<script>
  import { fade, scale } from 'svelte/transition';
  import Icon from './Icon.svelte';
  import ConfigView from './ConfigView.svelte';
  import { app, mutate } from '../lib/store.svelte.js';
  import { nameProblem, errorText } from '../lib/format.js';

  let name = $state('');
  let touched = $state(false);
  let busy = $state(false);
  let error = $state(null);
  let created = $state(null); // {name, config}

  let existing = $derived(app.list?.clients.map((c) => c.name) ?? []);
  let problem = $derived(nameProblem(name, existing));
  let up = $derived(app.list?.interface.up ?? true);

  $effect(() => {
    if (app.adding) {
      name = '';
      touched = false;
      error = null;
      created = null;
      busy = false;
    }
  });

  function close() {
    if (busy) return;
    app.adding = false;
  }

  async function submit(e) {
    e.preventDefault();
    touched = true;
    if (!name || problem || busy) return;
    busy = true;
    error = null;
    const target = name;
    const r = await mutate('add', target);
    busy = false;
    if (r.ok) {
      created = { name: target, config: r.data.config };
    } else if (r.error.code === 'backend_failed' || r.error.code === 'timeout') {
      app.adding = false; // the persistent warning takes over
    } else {
      error = errorText(r.error);
    }
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && app.adding && close()} />

{#if app.adding}
  <div class="fixed inset-0 z-40 bg-[var(--scrim)]" transition:fade={{ duration: 140 }} onclick={close} aria-hidden="true"></div>
  <div class="pointer-events-none fixed inset-0 z-50 grid place-items-center p-4">
    <div
      class="pointer-events-auto flex max-h-full w-full max-w-md flex-col overflow-y-auto rounded-2xl border border-line bg-bg shadow-lift"
      transition:scale={{ start: 0.96, duration: 160 }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-title"
    >
      <header class="flex items-center justify-between px-5 pt-5">
        <h2 id="add-title" class="text-lg font-semibold">{created ? `${created.name} is ready` : 'Add a client'}</h2>
        <button class="grid size-9 place-items-center rounded-lg text-ink-2 hover:bg-sunken" onclick={close} aria-label="Close" disabled={busy}><Icon name="x" /></button>
      </header>

      {#if created}
        <div class="flex flex-col gap-4 px-5 pt-2 pb-5">
          <ConfigView name={created.name} config={created.config} open="qr" />
          <div class="flex justify-end gap-2">
            <button class="btn btn-ghost" onclick={() => { app.adding = false; app.selected = created.name; }}>Open client</button>
            <button class="btn btn-primary" onclick={close}>Done</button>
          </div>
        </div>
      {:else}
        <form class="flex flex-col gap-4 px-5 pt-2 pb-5" onsubmit={submit} novalidate>
          <div class="flex flex-col gap-1.5">
            <label for="add-name" class="text-sm font-medium">Name</label>
            <!-- svelte-ignore a11y_autofocus -->
            <input
              id="add-name"
              class="field font-mono"
              bind:value={name}
              oninput={() => (touched = true)}
              maxlength="15"
              autocomplete="off"
              spellcheck="false"
              autofocus
              disabled={busy}
              aria-invalid={touched && !!problem}
              aria-describedby="add-help"
            />
            <div id="add-help" class="flex justify-between gap-3 text-xs">
              {#if touched && problem}
                <span class="text-off">{problem}</span>
              {:else}
                <span class="text-ink-3">Letters, digits, _ and -. Up to 15 characters. Must be unique.</span>
              {/if}
              <span class="tabular shrink-0 {name.length > 15 ? 'text-off' : 'text-ink-3'}">{name.length}/15</span>
            </div>
          </div>

          {#if error}<p class="text-sm text-off">{error}</p>{/if}

          {#if busy}
            <div class="flex items-center gap-3 rounded-lg bg-surface-2 px-3 py-2.5 text-sm text-ink-2">
              <span class="size-4 animate-spin rounded-full border-2 border-accent border-t-transparent"></span>
              Creating keys and config on the host. This can take up to a minute.
            </div>
          {/if}

          <div class="flex justify-end gap-2">
            <button type="button" class="btn btn-ghost" onclick={close} disabled={busy}>Cancel</button>
            <button type="submit" class="btn btn-primary" disabled={busy || !up || !name || !!problem || !!app.hostError}>Add client</button>
          </div>
        </form>
      {/if}
    </div>
  </div>
{/if}

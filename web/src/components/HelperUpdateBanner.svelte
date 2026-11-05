<script>
  // Notice shown when the helper on the server is older than the one this
  // image ships (the backend reads its version from the bundled helper file).
  // Clears itself once the server reports the bundled version or newer.
  import { slide } from 'svelte/transition';
  import Icon from './Icon.svelte';
  import { app, connect, notify } from '../lib/store.svelte.js';
  import { installCommand, versionOlder } from '../lib/format.js';
  import { copyText, COPY_FAILED } from '../lib/clipboard.js';

  let installed = $derived(app.version?.helper_version);
  let bundled = $derived(app.settings?.bundledHelper);
  let show = $derived(!app.hostError && versionOlder(installed, bundled));
  let open = $state(false);
  let checking = $state(false);
  let command = $derived(app.settings ? installCommand(app.settings.publicKey) : '');

  async function copy() {
    notify((await copyText(command)) ? 'Command copied' : COPY_FAILED);
  }

  async function recheck() {
    checking = true;
    await connect();
    checking = false;
    notify(versionOlder(app.version?.helper_version, app.settings?.bundledHelper) ? 'The helper is still out of date' : 'Helper is up to date');
  }

  function toSettings() {
    app.view = 'settings';
    app.selected = null;
  }
</script>

{#if show}
  <section class="overflow-hidden rounded-xl border border-line bg-surface shadow-card" transition:slide={{ duration: 200 }} aria-label="Helper update">
    <div class="flex gap-3 border-l-4 border-accent p-4">
      <Icon name="refresh" size={20} class="mt-0.5 shrink-0 text-accent" />
      <div class="flex min-w-0 flex-1 flex-col gap-3 text-sm">
        <div>
          <div class="font-semibold">Helper update available</div>
          <div class="text-ink-2">
            Your server runs helper {installed}; this version of WG Manager comes with {bundled}. Run the update command on
            the server, then check again.
          </div>
        </div>

        {#if open}
          <div class="flex flex-col gap-1.5" transition:slide={{ duration: 160 }}>
            <div class="flex items-center justify-between text-sm">
              <span class="font-medium">Update command</span>
              <button class="flex items-center gap-1 text-xs text-accent hover:underline" onclick={copy}><Icon name="copy" size={13} /> Copy</button>
            </div>
            <pre class="overflow-x-auto rounded-lg bg-sunken p-3 font-mono text-[12.5px] leading-relaxed whitespace-pre text-ink">{command}</pre>
          </div>
        {/if}

        <div class="flex flex-wrap items-center gap-2">
          <button class="btn btn-ghost" onclick={() => (open = !open)} aria-expanded={open}>
            <Icon name={open ? 'up' : 'down'} size={16} /> {open ? 'Hide update command' : 'Show update command'}
          </button>
          <button class="btn btn-ghost" onclick={recheck} disabled={checking}>
            <Icon name="refresh" size={16} class={checking ? 'animate-spin' : ''} /> Check again
          </button>
          <button class="text-xs text-ink-3 hover:text-ink hover:underline" onclick={toSettings}>Also in Settings › App key</button>
        </div>
      </div>
    </div>
  </section>
{/if}

<script>
  import { fly, fade } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import Icon from './Icon.svelte';
  import StatusDot from './StatusDot.svelte';
  import SessionMeter from './SessionMeter.svelte';
  import ConfigView from './ConfigView.svelte';
  import { app, mutate, notify } from '../lib/store.svelte.js';
  import { bytes, status, ago, date, errorText } from '../lib/format.js';

  let client = $derived(app.list?.clients.find((c) => c.name === app.selected) ?? null);
  let name = $derived(app.selected);
  let up = $derived(app.list?.interface.up ?? true);
  let st = $derived(client ? status(client, up) : null);
  let pending = $derived(name ? app.pending[name] : null);
  let confirming = $state(null); // 'disable' | 'remove'
  let lastError = $state(null);

  // reset per client
  $effect(() => {
    name;
    confirming = null;
    lastError = null;
  });

  function close() {
    app.selected = null;
  }

  function onkey(e) {
    if (e.key === 'Escape' && app.selected) close();
  }

  async function run(action) {
    const target = name;
    confirming = null;
    lastError = null;
    const r = await mutate(action, target);
    if (r.ok) {
      if (action === 'remove') {
        notify(`Deleted ${target}`);
        if (app.selected === target) close();
      } else if (r.data.changed === false) {
        notify(`${target} was already ${action}d`);
      } else {
        notify(`${action === 'enable' ? 'Enabled' : 'Disabled'} ${target}`);
      }
    } else if (r.error.code !== 'backend_failed' && r.error.code !== 'timeout') {
      lastError = errorText(r.error);
    }
  }

  async function copyKey() {
    try {
      await navigator.clipboard.writeText(client.public_key);
      notify('Public key copied');
    } catch {
      notify('Copy was blocked. Select the key and copy it instead.');
    }
  }

  let canEnable = $derived(client && client.enabled === false && up);
  let canReEnable = $derived(client && client.enabled === true && !client.live && up);
  let isEnabled = $derived(client?.enabled === true);
</script>

<svelte:window onkeydown={onkey} />

{#if name}
  <div class="fixed inset-0 z-40 bg-[var(--scrim)]" transition:fade={{ duration: 160 }} onclick={close} aria-hidden="true"></div>
  <div
    class="fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-bg shadow-lift sm:w-[440px] sm:border-l sm:border-line"
    style="padding-top: env(safe-area-inset-top, 0px); padding-bottom: env(safe-area-inset-bottom, 0px); padding-right: env(safe-area-inset-right, 0px)"
    transition:fly={{ x: 460, duration: 260, easing: cubicOut }}
    role="dialog"
    aria-modal="true"
    aria-label="Client {name}"
  >
    <header class="flex items-start gap-3 border-b border-line px-5 pt-5 pb-4">
      {#if st}<div class="pt-2"><StatusDot tone={st.tone} /></div>{/if}
      <div class="min-w-0 flex-1">
        <h2 class="truncate text-lg font-semibold">{name}</h2>
        <div class="text-sm text-ink-2">{st?.label ?? 'No longer on the host'}</div>
      </div>
      <button class="grid size-9 place-items-center rounded-lg text-ink-2 hover:bg-sunken" onclick={close} aria-label="Close"><Icon name="x" /></button>
    </header>

    <div class="flex flex-1 flex-col gap-6 overflow-y-auto px-5 py-5">
      {#if !client}
        <p class="text-sm text-ink-2">This client is not in the latest list from the host.</p>
      {:else}
        {#if app.flagged[name]}
          <div class="rounded-lg border border-warn-line bg-warn-soft px-3 py-2.5 text-sm">
            The last change to this client may be incomplete. See the warning at the top of the page.
          </div>
        {/if}

        {#if client.live}
          <section class="rounded-xl border border-line bg-surface p-4">
            <SessionMeter {client} now={app.now} />
            <dl class="tabular mt-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt class="text-xs text-ink-3">Downloaded</dt>
                <dd class="font-medium">{bytes(client.transfer_tx)}</dd>
              </div>
              <div>
                <dt class="text-xs text-ink-3">Uploaded</dt>
                <dd class="font-medium">{bytes(client.transfer_rx)}</dd>
              </div>
            </dl>
            <p class="mt-3 text-xs text-ink-3">Totals since the interface last started.</p>
          </section>
        {/if}

        <section class="flex flex-col gap-3">
          <h3 class="text-sm font-semibold">Connect a device</h3>
          {#key name}<ConfigView {name} />{/key}
        </section>

        <section class="flex flex-col gap-3">
          <h3 class="text-sm font-semibold">Details</h3>
          <dl class="flex flex-col divide-y divide-line rounded-xl border border-line bg-surface text-sm">
            <div class="flex justify-between gap-4 px-4 py-2.5">
              <dt class="text-ink-2">Address</dt>
              <dd class="font-mono text-[13px]">{client.address}</dd>
            </div>
            <div class="flex justify-between gap-4 px-4 py-2.5">
              <dt class="text-ink-2">Endpoint</dt>
              <dd class="min-w-0 truncate font-mono text-[13px]">{client.endpoint ?? '—'}</dd>
            </div>
            <div class="flex justify-between gap-4 px-4 py-2.5">
              <dt class="text-ink-2">Last handshake</dt>
              <dd class="tabular">{client.latest_handshake ? ago(client.latest_handshake, app.now) : client.live ? 'None since the interface started' : '—'}</dd>
            </div>
            <div class="flex justify-between gap-4 px-4 py-2.5">
              <dt class="text-ink-2">Created</dt>
              <dd>{date(client.created_at)}</dd>
            </div>
            <div class="flex flex-col gap-1 px-4 py-2.5">
              <dt class="flex items-center justify-between text-ink-2">
                Public key
                <button class="text-xs text-accent hover:underline" onclick={copyKey}>Copy</button>
              </dt>
              <dd class="font-mono text-[12.5px] break-all text-ink-2 select-all">{client.public_key}</dd>
            </div>
          </dl>
        </section>

        <section class="flex flex-col gap-3">
          <h3 class="text-sm font-semibold">Manage</h3>

          {#if pending}
            <div class="flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-sm">
              <span class="size-4 animate-spin rounded-full border-2 border-accent border-t-transparent"></span>
              <span>
                {pending === 'remove' ? 'Deleting' : pending === 'enable' ? 'Enabling' : 'Disabling'} {name}. This can take up to a minute.
              </span>
            </div>
          {:else if confirming === 'disable'}
            <div class="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4 text-sm">
              <p>Disable {name}? {client.endpoint && client.live ? 'Its current session ends right away. ' : ''}You can enable it again later; its keys and config are kept.</p>
              <div class="flex gap-2">
                <button class="btn btn-danger" onclick={() => run('disable')}>Disable</button>
                <button class="btn btn-ghost" onclick={() => (confirming = null)}>Cancel</button>
              </div>
            </div>
          {:else if confirming === 'remove'}
            <div class="flex flex-col gap-3 rounded-xl border border-off/40 bg-off-soft p-4 text-sm">
              <p>Delete {name}? This removes its keys and config from the server. Any device using it stops connecting, and the config cannot be downloaded again.</p>
              <div class="flex gap-2">
                <button class="btn btn-danger" onclick={() => run('remove')}>Delete {name}</button>
                <button class="btn btn-ghost" onclick={() => (confirming = null)}>Cancel</button>
              </div>
            </div>
          {:else}
            <div class="flex flex-wrap gap-2">
              {#if isEnabled}
                <button class="btn btn-ghost" onclick={() => (confirming = 'disable')}><Icon name="power" size={16} /> Disable</button>
                {#if canReEnable}
                  <button class="btn btn-ghost" onclick={() => run('enable')} title="Runs pivpn on again, which reloads WireGuard"><Icon name="refresh" size={16} /> Enable again</button>
                {/if}
              {:else}
                <button class="btn btn-ghost" disabled={!canEnable} onclick={() => run('enable')}><Icon name="power" size={16} /> Enable</button>
              {/if}
              <button class="btn btn-danger-ghost" onclick={() => (confirming = 'remove')}><Icon name="trash" size={16} /> Delete</button>
            </div>
            {#if !up && !isEnabled}
              <p class="text-xs text-ink-3">Enable is off while the interface is down.</p>
            {/if}
            {#if client.enabled === null}
              <p class="text-xs text-ink-3">The server config has no entry for this client, so there is nothing to enable or disable. Fix it with pivpn on the server.</p>
            {/if}
          {/if}

          {#if lastError}
            <p class="text-sm text-off">{lastError}</p>
          {/if}
        </section>
      {/if}
    </div>
  </div>
{/if}

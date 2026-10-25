<script>
  import { copyText, COPY_FAILED } from '../lib/clipboard.js';
  import Icon from '../components/Icon.svelte';
  import { app, connect, PROTOCOL, notify } from '../lib/store.svelte.js';
  import { errorText } from '../lib/format.js';

  let v = $derived(app.version);
  let iface = $derived(app.list?.interface);
  let ssh = $derived(app.settings?.ssh);
  let checking = $state(false);
  let protoOk = $derived(v && v.protocol === PROTOCOL);

  async function recheck() {
    checking = true;
    await connect();
    checking = false;
    notify(app.hostError ? 'Host check found a problem' : 'Host checked');
  }

  async function copy(text) {
    notify((await copyText(text)) ? 'Copied' : COPY_FAILED);
  }
</script>

<header class="flex flex-wrap items-end justify-between gap-4">
  <div class="flex flex-col gap-1">
    <h1 class="text-2xl font-semibold tracking-tight">Host</h1>
  </div>
  <button class="btn btn-ghost" onclick={recheck} disabled={checking}>
    <Icon name="refresh" size={16} class={checking ? 'animate-spin' : ''} /> Check again
  </button>
</header>

{#if app.hostError}
  <div class="flex gap-3 rounded-xl border border-off/40 bg-off-soft px-4 py-3 text-sm">
    <Icon name="alert" size={18} class="mt-0.5 shrink-0 text-off" />
    <div>
      <div class="font-medium">
        {app.hostError.code === 'protocol_mismatch'
          ? 'Helper and app versions do not match'
          : app.hostError.code === 'hostkey_changed'
            ? "The server's identity changed"
            : 'The host has a problem'}
      </div>
      <div class="text-ink-2">{errorText(app.hostError)}</div>
      {#if app.hostError.code === 'hostkey_changed'}
        <button class="mt-2 btn btn-ghost h-8" onclick={() => (app.view = 'settings')}>Review in Settings</button>
      {/if}
      {#if app.hostError.code === 'protocol_mismatch'}
        <div class="mt-1 text-ink-3">Managing clients is paused until they match.</div>
      {/if}
    </div>
  </div>
{/if}

<div class="grid gap-4 lg:grid-cols-2">
  <section class="flex flex-col gap-4 rounded-xl border border-line bg-surface p-5 shadow-card">
    <div class="flex items-center justify-between">
      <h2 class="font-semibold">WireGuard interface</h2>
      {#if iface}
        <span class="flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium {iface.up ? 'bg-live-soft text-live' : 'bg-off-soft text-off'}">
          <span class="size-1.5 rounded-full {iface.up ? 'bg-live' : 'bg-off'}"></span>{iface.up ? 'Up' : 'Down'}
        </span>
      {/if}
    </div>
    {#if iface}
      <dl class="flex flex-col divide-y divide-line text-sm">
        <div class="flex justify-between gap-4 py-2"><dt class="text-ink-2">Name</dt><dd class="font-mono">{iface.name}</dd></div>
        <div class="flex justify-between gap-4 py-2"><dt class="text-ink-2">Listen port</dt><dd class="font-mono">{iface.listen_port ?? '—'} {#if iface.listen_port}<span class="font-sans text-ink-3">UDP</span>{/if}</dd></div>
        <div class="flex flex-col gap-1 py-2">
          <dt class="flex justify-between text-ink-2">Server public key {#if iface.public_key}<button class="text-xs text-accent hover:underline" onclick={() => copy(iface.public_key)}>Copy</button>{/if}</dt>
          <dd class="font-mono text-[12.5px] break-all text-ink-2">{iface.public_key ?? 'Not available while the interface is down'}</dd>
        </div>
        <div class="flex justify-between gap-4 py-2"><dt class="text-ink-2">Clients</dt><dd class="tabular">{app.list.clients.length}</dd></div>
      </dl>
    {:else}
      <p class="text-sm text-ink-3">No data yet.</p>
    {/if}
  </section>

  <section class="flex flex-col gap-4 rounded-xl border border-line bg-surface p-5 shadow-card">
    <div class="flex items-center justify-between">
      <h2 class="font-semibold">Helper</h2>
      {#if v}
        <span class="flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium {protoOk ? 'bg-live-soft text-live' : 'bg-off-soft text-off'}">
          {protoOk ? 'Compatible' : 'Not compatible'}
        </span>
      {/if}
    </div>
    {#if v}
      <dl class="flex flex-col divide-y divide-line text-sm">
        <div class="flex justify-between gap-4 py-2"><dt class="text-ink-2">Version</dt><dd class="font-mono">{v.helper_version}</dd></div>
        <div class="flex justify-between gap-4 py-2"><dt class="text-ink-2">Protocol</dt><dd class="font-mono">{v.protocol} <span class="font-sans text-ink-3">(app expects {PROTOCOL})</span></dd></div>
        <div class="flex justify-between gap-4 py-2"><dt class="text-ink-2">Backend</dt><dd>{v.backend === 'pivpn' ? 'PiVPN' : v.backend}</dd></div>
        {#if ssh}
          <div class="flex justify-between gap-4 py-2"><dt class="text-ink-2">Reached at</dt><dd class="font-mono text-[13px]">{ssh.user}@{ssh.host}:{ssh.port}</dd></div>
        {/if}
      </dl>
    {:else}
      <p class="text-sm text-ink-3">No data yet.</p>
    {/if}
  </section>
</div>

{#if v?.pivpn_scripts}
  <section class="flex flex-col gap-3 rounded-xl border border-line bg-surface p-5 shadow-card">
    <h2 class="font-semibold">PiVPN scripts</h2>
    <div class="overflow-x-auto">
      <table class="w-full min-w-[520px] text-left text-sm">
        <tbody>
          {#each Object.entries(v.pivpn_scripts) as [file, hash]}
            <tr class="border-t border-line first:border-0">
              <td class="py-2 pr-4 font-mono text-[13px] whitespace-nowrap">{file}</td>
              <td class="py-2 font-mono text-[12px] break-all text-ink-3">{hash ?? 'unreadable'}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>
{/if}

{#if app.list?.warnings.length}
  <section class="flex flex-col gap-2 rounded-xl border border-warn-line bg-warn-soft p-5 text-sm">
    <h2 class="font-semibold text-warn">Warnings from the host</h2>
    <ul class="flex flex-col gap-0.5 pl-5 text-ink-2">
      {#each app.list.warnings as w}<li class="list-disc break-words">{w}</li>{/each}
    </ul>
  </section>
{/if}

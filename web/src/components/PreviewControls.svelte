<script>
  // Preview-only panel for switching the mock helper into each state the UI
  // must handle. Not part of the real app (rendered only in mock mode).
  import { fly } from 'svelte/transition';
  import Icon from './Icon.svelte';
  import { getMock } from '../lib/api.js';
  import { app, refresh, connect, boot } from '../lib/store.svelte.js';

  let open = $state(false);
  let flags = $state({});
  let mock = null;

  getMock().then((m) => {
    mock = m;
    sync();
  });

  function sync() {
    flags = { ...mock.scenarios, ...mock.appScenarios };
  }

  const groups = [
    {
      title: 'Host',
      items: [
        { key: 'interfaceDown', label: 'Interface down', reconnect: false },
        { key: 'hostMisconfigured', label: 'Host misconfigured (exit 6)' },
        { key: 'protocolMismatch', label: 'Helper protocol mismatch', reconnect: true },
        { key: 'firstRun', label: 'First run (key not installed)', reconnect: true, app: true },
        { key: 'noPassword', label: 'Fresh install (no password yet)', reboot: true, app: true },
        { key: 'hostKeyChanged', label: 'Server identity changed', reconnect: true, app: true },
        { key: 'serverOffline', label: 'Server offline', reconnect: true, app: true },
        { key: 'sessionExpired', label: 'Session expires', app: true },
      ],
    },
    {
      title: 'Clients',
      items: [
        { key: 'unmanageable', label: 'Unmanageable clients' },
        { key: 'inconsistent', label: 'Client missing from server config' },
        { key: 'bigCounters', label: 'Client past 1 TiB' },
      ],
    },
    {
      title: 'Next change',
      items: [
        { key: 'failNextMutation', label: 'Fails partway (exit 5)' },
        { key: 'busyNext', label: 'Host busy (exit 7)' },
        { key: 'sshTimeout', label: 'SSH timeout', app: true },
        { key: 'subnetFull', label: 'Subnet full (on add)' },
      ],
    },
  ];

  async function toggle(item) {
    const target = item.app ? mock.appScenarios : mock.scenarios;
    target[item.key] = !target[item.key];
    if (item.key === 'firstRun' && target.firstRun) mock.appScenarios.hostKeyPinned = false;
    sync();
    if (item.reboot) await boot();
    else if (item.reconnect || app.phase !== 'ready') await connect();
    else await refresh();
  }

  function setSpeed(ms) {
    mock.scenarios.mutationDelayMs = ms;
    sync();
  }
</script>

<!-- Bottom-left (beside the sidebar) so the client panel never covers it. -->
<div
  class="fixed bottom-20 left-4 z-[60] flex flex-col items-start gap-2 md:bottom-4 md:left-64"
>
  {#if open}
    <div
      class="flex max-h-[70dvh] w-72 flex-col gap-4 overflow-y-auto rounded-xl border border-line bg-surface p-4 text-sm shadow-lift"
      transition:fly={{ y: 12, duration: 160 }}
    >
      <div>
        <div class="font-semibold">Preview controls</div>
        <p class="text-xs text-ink-3">Fake data only. Switch the mock helper into states the real one can report.</p>
      </div>
      {#each groups as g}
        <fieldset class="flex flex-col gap-1.5">
          <legend class="mb-1 text-xs font-medium text-ink-3">{g.title}</legend>
          {#each g.items as item}
            <label class="flex cursor-pointer items-center justify-between gap-3 rounded-md px-1 py-1 hover:bg-surface-2">
              <span>{item.label}</span>
              <input type="checkbox" class="size-4 accent-[var(--accent)]" checked={!!flags[item.key]} onchange={() => toggle(item)} />
            </label>
          {/each}
        </fieldset>
      {/each}
      <fieldset class="flex flex-col gap-1.5">
        <legend class="mb-1 text-xs font-medium text-ink-3">Change speed</legend>
        <div class="flex gap-2">
          <button class="btn h-8 flex-1 {flags.mutationDelayMs === 1800 ? 'btn-primary' : 'btn-ghost'}" onclick={() => setSpeed(1800)}>Quick</button>
          <button class="btn h-8 flex-1 {flags.mutationDelayMs === 12000 ? 'btn-primary' : 'btn-ghost'}" onclick={() => setSpeed(12000)}>Slow (12 s)</button>
        </div>
      </fieldset>
    </div>
  {/if}
  <button
    class="flex h-10 items-center gap-2 rounded-full border border-line bg-surface px-4 text-sm font-medium shadow-lift hover:bg-surface-2"
    onclick={() => (open = !open)}
    aria-expanded={open}
  >
    <Icon name={open ? 'x' : 'flask'} size={16} /> Preview
  </button>
</div>

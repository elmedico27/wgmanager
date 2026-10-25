<script>
  import Icon from './Icon.svelte';
  import { app, logout, savePrefs } from '../lib/store.svelte.js';

  const nav = [
    { id: 'clients', label: 'Clients', icon: 'clients' },
    { id: 'host', label: 'Host', icon: 'host' },
    { id: 'settings', label: 'Settings', icon: 'settings' },
  ];

  const themeOrder = ['system', 'light', 'dark'];
  const themeIcon = { system: 'auto', light: 'sun', dark: 'moon' };
  const themeLabel = { system: 'Theme: follows system', light: 'Theme: light', dark: 'Theme: dark' };

  function cycleTheme() {
    app.theme = themeOrder[(themeOrder.indexOf(app.theme) + 1) % 3];
    savePrefs();
  }

  function go(id) {
    // On `/` the page is already Clients, so the address would otherwise stay `/`.
    if (id === 'clients' && location.pathname === '/') history.pushState(null, '', '/clients');
    app.view = id;
    app.selected = null;
  }

  let iface = $derived(app.list?.interface);
  let count = $derived(app.list?.clients.length ?? null);
  let hostAttention = $derived(!!app.hostError || (iface && !iface.up));
</script>

<!-- Desktop rail -->
<aside
  class="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col bg-rail text-rail-ink md:flex"
  style="padding-left: env(safe-area-inset-left, 0px)"
>
  <div class="flex items-center gap-3 px-5 pt-6 pb-8">
    <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <circle cx="10" cy="16" r="3.2" fill="none" stroke="var(--on-accent)" stroke-width="2" />
      <circle cx="22" cy="16" r="3.2" fill="none" stroke="var(--on-accent)" stroke-width="2" />
      <path d="M13.2 13.5h5.6M13.2 18.5h5.6" stroke="var(--on-accent)" stroke-width="2" stroke-linecap="round" />
    </svg>
    <div class="leading-tight">
      <div class="text-[15px] font-semibold text-white">WG Manager</div>
      <div class="text-xs text-rail-ink-2">WireGuard via PiVPN</div>
    </div>
  </div>

  <nav class="flex flex-col gap-1 px-3" aria-label="Main">
    {#each nav as item}
      <button
        class="group flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors
          {app.view === item.id ? 'bg-rail-active text-white' : 'text-rail-ink hover:bg-rail-active/60 hover:text-white'}"
        aria-current={app.view === item.id ? 'page' : undefined}
        onclick={() => go(item.id)}
      >
        <Icon name={item.icon} />
        <span class="flex-1">{item.label}</span>
        {#if item.id === 'clients' && count !== null}
          <span class="tabular text-xs text-rail-ink-2">{count}</span>
        {/if}
        {#if item.id === 'host' && hostAttention}
          <span class="size-2 rounded-full bg-warn" title="Needs attention"></span>
        {/if}
      </button>
    {/each}
  </nav>

  <div class="mt-auto flex flex-col gap-1 px-3 pb-5">
    {#if iface}
      <div class="mb-3 rounded-lg border border-white/5 px-3 py-2.5 text-xs">
        <div class="flex items-center gap-2 text-rail-ink">
          <span class="size-2 rounded-full {iface.up ? 'bg-live' : 'bg-off'}"></span>
          <span class="font-mono">{iface.name}</span>
          <span class="text-rail-ink-2">{iface.up ? 'up' : 'down'}</span>
        </div>
        {#if iface.up}
          <div class="mt-1 text-rail-ink-2">Listening on UDP {iface.listen_port}</div>
        {/if}
      </div>
    {/if}
    <button
      class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-rail-ink-2 hover:bg-rail-active/60 hover:text-white"
      onclick={cycleTheme}
      title="Switch theme"
    >
      <Icon name={themeIcon[app.theme]} />
      {themeLabel[app.theme]}
    </button>
    <button
      class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-rail-ink-2 hover:bg-rail-active/60 hover:text-white"
      onclick={logout}
    >
      <Icon name="logout" />
      Sign out
    </button>
  </div>
</aside>

<!-- Phone tab bar -->
<nav
  class="fixed inset-x-0 bottom-0 z-30 flex justify-around border-t border-white/5 bg-rail md:hidden"
  style="padding-bottom: env(safe-area-inset-bottom, 0px); padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px))"
  aria-label="Main"
>
  {#each nav as item}
    <button
      class="relative flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] {app.view === item.id ? 'text-white' : 'text-rail-ink-2'}"
      aria-current={app.view === item.id ? 'page' : undefined}
      onclick={() => go(item.id)}
    >
      <Icon name={item.icon} size={20} />
      {item.label}
      {#if item.id === 'host' && hostAttention}
        <span class="absolute top-2 right-[calc(50%-16px)] size-2 rounded-full bg-warn"></span>
      {/if}
    </button>
  {/each}
</nav>

<script>
  // The top bar: brand, the three pages, interface health and sign-out.
  import Icon from './Icon.svelte';
  import Logo from './Logo.svelte';
  import { app, logout, savePrefs } from '../lib/store.svelte.js';
  import { DEMO } from '../lib/api.js';
  import { USE_ADDRESS } from '../lib/routes.js';
  import { pushRoute } from '../lib/nav.js';

  const nav = [
    { id: 'clients', label: 'Clients', icon: 'clients' },
    { id: 'host', label: 'Host', icon: 'host' },
    { id: 'settings', label: 'Settings', icon: 'settings' },
  ];

  function go(id) {
    // On `/` the page is already Clients, so the address would otherwise stay `/`.
    if (USE_ADDRESS && id === 'clients' && location.pathname === '/') pushRoute('/clients');
    app.view = id;
    app.selected = null;
  }

  let iface = $derived(app.list?.interface);
  let hostAttention = $derived(!!app.hostError || (iface && !iface.up));

  // A newer release exists (settings.update). The dot shows until the Host page
  // has been opened once for that release; the Software card keeps the notice.
  let update = $derived(app.settings?.update);
  let updateDot = $derived(!!update && app.updateSeen !== update.latest && app.view !== 'host');
  $effect(() => {
    if (app.view === 'host' && update && app.updateSeen !== update.latest) {
      app.updateSeen = update.latest;
      savePrefs();
    }
  });
</script>

<header class="on-rail sticky top-0 z-30 bg-rail text-rail-ink" style="padding-top: env(safe-area-inset-top, 0px)">
  <div
    class="mx-auto flex h-[60px] max-w-[1680px] items-center gap-3 sm:gap-6"
    style="padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px))"
  >
    <div class="flex items-center gap-3 text-white">
      <Logo size={32} />
      <span class="hidden text-[15px] font-semibold sm:inline">WG Manager</span>
    </div>

    <nav class="flex gap-1" aria-label="Main">
      {#each nav as item}
        <button
          class="relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors
            {app.view === item.id ? 'bg-rail-active text-white' : 'text-rail-ink hover:bg-rail-active/60 hover:text-white'}"
          aria-current={app.view === item.id ? 'page' : undefined}
          aria-label={item.label}
          title={item.label}
          onclick={() => go(item.id)}
        >
          <Icon name={item.icon} />
          <span class="hidden sm:inline">{item.label}</span>
          {#if item.id === 'host' && hostAttention}
            <span class="size-2 rounded-full bg-warn" role="img" aria-label="Needs attention" title="Needs attention"></span>
          {:else if item.id === 'host' && updateDot}
            <!-- White reads on the dark bar in both themes and stays apart from the amber "needs attention" dot. -->
            <span class="size-2 rounded-full bg-white" role="img" aria-label="Update available" title="Update available"></span>
          {/if}
        </button>
      {/each}
    </nav>

    <div class="ml-auto flex items-center gap-1 sm:gap-3">
      {#if DEMO}
        <span class="rounded-md border border-white/20 px-2 py-0.5 text-[13px] text-white" title="Not connected to a server. Your changes stay in this browser tab.">Demo</span>
      {/if}
      {#if iface}
        <div class="flex items-center gap-2 px-2 text-[13px] whitespace-nowrap">
          <span class="size-2 rounded-full {iface.up ? 'bg-live' : 'bg-off'}" aria-hidden="true"></span>
          <span class="font-mono">{iface.name}</span>
          <span class="hidden text-rail-ink-2 sm:inline">{iface.up ? 'up' : 'down'}</span>
          {#if iface.up}
            <span class="hidden h-3.5 w-px bg-white/30 md:inline-block" aria-hidden="true"></span>
            <span class="hidden text-rail-ink-2 md:inline">UDP {iface.listen_port}</span>
          {/if}
          <span class="sr-only sm:hidden">{iface.up ? 'up' : 'down'}</span>
        </div>
      {/if}
      <button
        class="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-rail-ink-2 hover:bg-rail-active/60 hover:text-white"
        onclick={logout}
        aria-label="Sign out"
        title="Sign out"
      >
        <Icon name="logout" />
        <span class="hidden lg:inline">Sign out</span>
      </button>
    </div>
  </div>
</header>

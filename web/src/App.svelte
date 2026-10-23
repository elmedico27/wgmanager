<script>
  import { app, boot } from './lib/store.svelte.js';
  import { MOCK } from './lib/api.js';
  import Sidebar from './components/Sidebar.svelte';
  import FailureBanner from './components/FailureBanner.svelte';
  import DetailPanel from './components/DetailPanel.svelte';
  import AddDialog from './components/AddDialog.svelte';
  import PreviewControls from './components/PreviewControls.svelte';
  import Login from './views/Login.svelte';
  import Setup from './views/Setup.svelte';
  import FirstRun from './views/FirstRun.svelte';
  import Clients from './views/Clients.svelte';
  import Host from './views/Host.svelte';
  import Settings from './views/Settings.svelte';

  $effect(() => {
    const root = document.documentElement;
    if (app.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', app.theme);
  });

  boot();
</script>

{#if app.phase === 'loading'}
  <div class="grid min-h-dvh place-items-center text-ink-3">Loading…</div>
{:else if app.phase === 'offline'}
  <div class="gutter grid min-h-dvh place-items-center py-10">
    <div class="flex max-w-sm flex-col items-center gap-3 text-center">
      <h1 class="text-lg font-semibold">WG Manager is not answering</h1>
      <p class="text-sm text-ink-2">
        The page loaded, but the WG Manager server did not respond. It may be restarting. Check that the container is
        running, then try again.
      </p>
      <button class="btn btn-primary" onclick={boot}>Try again</button>
    </div>
  </div>
{:else if app.phase === 'setup'}
  <Setup />
{:else if app.phase === 'login'}
  <Login />
{:else if app.phase === 'firstrun'}
  <FirstRun />
{:else}
  <div class="min-h-dvh md:pl-60">
    <Sidebar />
    <main class="gutter pb-28 pt-6 md:pb-12 md:pt-8">
      <div class="mx-auto flex max-w-6xl flex-col gap-6">
        <FailureBanner />
        {#if app.view === 'clients'}
          <Clients />
        {:else if app.view === 'host'}
          <Host />
        {:else}
          <Settings />
        {/if}
      </div>
    </main>
  </div>
  <DetailPanel />
  <AddDialog />
{/if}

{#if app.notice}
  <div
    role="status"
    class="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-ink px-4 py-2.5 text-sm text-bg shadow-lift md:bottom-6"
  >
    {app.notice.text}
  </div>
{/if}

{#if MOCK}
  <PreviewControls />
{/if}

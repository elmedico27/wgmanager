<script>
  import Icon from '../components/Icon.svelte';
  import StatusDot from '../components/StatusDot.svelte';
  import ClientCard from '../components/ClientCard.svelte';
  import { app, refresh, connect, savePrefs, isFlagged } from '../lib/store.svelte.js';
  import { bytes, status, connection, ago, errorText } from '../lib/format.js';
  import { SORT_KEYS, sortClients, nextSort } from '../lib/sort.js';
  import { filterClients, normalizeQuery } from '../lib/filter.js';
  import { tick } from 'svelte';
  import { slide } from 'svelte/transition';

  let list = $derived(app.list);
  let clients = $derived(list?.clients ?? []);
  let sorted = $derived(sortClients(clients, app.sort));
  // Search filters what is shown only; counts, links and the panel use the full list.
  let filtering = $derived(normalizeQuery(app.search) !== '');
  let shown = $derived(filterClients(sorted, app.search, app.notes));

  // The pull-out tray under the toolbar: 'search', 'sort' or null. Local to
  // this page, so it closes when you leave Clients; the search text does not.
  let tray = $state(null);
  let showSearch = $derived(clients.length > 1 || filtering);
  let showSort = $derived(app.layout === 'cards' && clients.length > 1);
  let searchInput = $state(null);
  let searchButton = $state(null);
  $effect(() => {
    if ((tray === 'sort' && !showSort) || (tray === 'search' && !showSearch)) tray = null;
  });

  async function toggleTray(which) {
    tray = tray === which ? null : which;
    if (tray === 'search') {
      await tick();
      searchInput?.focus();
    }
  }

  // Escape in the search field closes the tray and keeps the filter; it must
  // not reach the client panel's Escape handler on the window.
  function searchKey(e) {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    tray = null;
    searchButton?.focus();
  }

  function clearSearch() {
    app.search = '';
  }
  let up = $derived(list?.interface.up ?? true);
  let counts = $derived.by(() => {
    const c = { live: 0, off: 0, warn: 0, connected: 0 };
    for (const x of clients) {
      c[status(x, up).tone]++;
      if (connection(x, app.now)?.connected) c.connected++;
    }
    return c;
  });
  let refreshing = $state(false);
  let sinceRefresh = $derived(app.lastRefresh ? Math.max(0, Math.round(app.now - app.lastRefresh / 1000)) : null);

  async function manualRefresh() {
    refreshing = true;
    if (app.hostError) await connect();
    else await refresh();
    refreshing = false;
  }

  let hostTitle = $derived(
    {
      unreachable: 'Cannot reach the server',
      timeout: 'The server is not answering',
      hostkey_changed: 'Stopped for safety',
      protocol_mismatch: 'Helper and app versions do not match',
      bad_response: 'The helper answered something unexpected',
      server_error: 'WG Manager hit an error',
    }[app.hostError?.code] ?? 'The server has a problem',
  );

  function setLayout(l) {
    app.layout = l;
    savePrefs();
  }

  function setSort(s) {
    app.sort = s;
    savePrefs();
  }
</script>

<header class="flex flex-wrap items-end justify-between gap-4">
  <div class="flex flex-col gap-1">
    <h1 class="text-2xl font-semibold tracking-tight">Clients</h1>
    {#if list}
      <p class="tabular flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-2">
        <span>{clients.length} total</span>
        <span class="flex items-center gap-1.5"><span class="size-2 rounded-full bg-live"></span>{counts.live} live</span>
        {#if counts.off}<span class="flex items-center gap-1.5"><span class="size-2 rounded-full bg-off"></span>{counts.off} disabled</span>{/if}
        {#if counts.warn}<span class="flex items-center gap-1.5"><span class="size-2 rounded-full bg-warn"></span>{counts.warn} need a look</span>{/if}
        <span>{counts.connected} connected now</span>
      </p>
    {/if}
  </div>

  <div class="flex items-center gap-2">
    <button
      class="btn btn-ghost px-2.5 text-ink-2"
      onclick={manualRefresh}
      title={sinceRefresh !== null ? `Refreshed ${sinceRefresh} s ago. Refreshes every 15 s.` : 'Refresh'}
      aria-label="Refresh"
    >
      <Icon name="refresh" size={16} class={refreshing ? 'animate-spin' : ''} />
    </button>
    {#if list && showSearch}
      <button
        bind:this={searchButton}
        class="btn btn-ghost relative px-2.5 {tray === 'search' ? 'border-ink-3! bg-sunken!' : ''}"
        onclick={() => toggleTray('search')}
        aria-expanded={tray === 'search'}
        aria-controls={tray === 'search' ? 'clients-tray' : undefined}
        aria-label={filtering ? 'Search (filter on)' : 'Search'}
        title={filtering ? 'Search: a filter is on' : 'Search'}
      >
        <Icon name="search" size={16} />
        {#if filtering}<span class="absolute -top-1 -right-1 size-2.5 rounded-full bg-accent ring-2 ring-bg" aria-hidden="true"></span>{/if}
      </button>
    {/if}
    {#if list && showSort}
      <button
        class="btn btn-ghost px-2.5 {tray === 'sort' ? 'border-ink-3! bg-sunken!' : ''}"
        onclick={() => toggleTray('sort')}
        aria-expanded={tray === 'sort'}
        aria-controls={tray === 'sort' ? 'clients-tray' : undefined}
        aria-label="Sort"
        title="Sort"
      >
        <Icon name="sort" size={16} />
      </button>
    {/if}
    <div class="flex rounded-[0.55rem] border border-line bg-surface p-0.5" role="group" aria-label="Layout">
      <button
        class="grid size-8 place-items-center rounded-md {app.layout === 'cards' ? 'bg-sunken text-ink' : 'text-ink-3 hover:text-ink'}"
        aria-pressed={app.layout === 'cards'}
        title="Cards"
        onclick={() => setLayout('cards')}><Icon name="grid" size={16} /></button>
      <button
        class="grid size-8 place-items-center rounded-md {app.layout === 'list' ? 'bg-sunken text-ink' : 'text-ink-3 hover:text-ink'}"
        aria-pressed={app.layout === 'list'}
        title="List"
        onclick={() => setLayout('list')}><Icon name="list" size={16} /></button>
    </div>
    <button
      class="btn btn-primary"
      disabled={!up || !list || !!app.hostError}
      title={app.hostError ? 'Changes are paused until the server can be reached' : !up ? 'The interface is down, so a new client could not go live' : undefined}
      onclick={() => (app.adding = true)}
    >
      <Icon name="plus" size={16} /> Add client
    </button>
  </div>
</header>

{#if list && tray}
  <div id="clients-tray" class="-mt-2 rounded-xl border border-line bg-surface p-3 shadow-card" transition:slide={{ duration: 150 }}>
    {#if tray === 'search'}
      <div class="relative">
        <Icon name="search" size={16} class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-3" />
        <input
          bind:this={searchInput}
          bind:value={app.search}
          onkeydown={searchKey}
          type="text"
          class="field pr-9! pl-9!"
          placeholder="Search name, address or note"
          aria-label="Search clients by name, address or note"
          autocomplete="off"
          spellcheck="false"
        />
        {#if app.search}
          <button class="absolute top-1/2 right-1.5 grid size-7 -translate-y-1/2 place-items-center rounded-md text-ink-3 hover:bg-sunken hover:text-ink" onclick={() => { clearSearch(); searchInput?.focus(); }} aria-label="Clear search" title="Clear search">
            <Icon name="x" size={14} />
          </button>
        {/if}
      </div>
    {:else}
      <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm" role="group" aria-label="Sort by">
        <span class="font-semibold text-ink">Sort by</span>
        {#each Object.keys(SORT_KEYS) as key}
          {@const active = app.sort.key === key}
          <button
            class="inline-flex items-center gap-1 {active ? 'font-medium text-accent' : 'text-ink-2 hover:text-ink'}"
            aria-pressed={active}
            aria-label={active ? `${SORT_KEYS[key].label}, ${app.sort.dir === 'asc' ? 'ascending' : 'descending'}, click to reverse` : SORT_KEYS[key].label}
            onclick={() => setSort(nextSort(app.sort, key))}
          >
            {SORT_KEYS[key].label}
            {#if active}<Icon name={app.sort.dir === 'asc' ? 'up' : 'down'} size={13} />{/if}
          </button>
        {/each}
      </div>
    {/if}
  </div>
{/if}

{#if app.hostError}
  <div class="flex flex-wrap items-start gap-3 rounded-xl border border-off/40 bg-off-soft px-4 py-3 text-sm">
    <Icon name="alert" size={18} class="mt-0.5 shrink-0 text-off" />
    <div class="min-w-0 flex-1">
      <div class="font-medium">{hostTitle}</div>
      <div class="text-ink-2">{errorText(app.hostError)}</div>
      <div class="mt-1 text-ink-3">
        {list ? 'The list below is the last one received. ' : ''}Changes are paused. WG Manager checks again every 15 seconds.
      </div>
    </div>
    <button class="btn btn-ghost h-8" onclick={manualRefresh} disabled={refreshing}>Check now</button>
  </div>
{:else if app.listError}
  <div class="flex flex-wrap items-center gap-3 rounded-xl border border-off/40 bg-off-soft px-4 py-3 text-sm">
    <Icon name="alert" size={16} class="text-off" />
    <span class="flex-1 text-ink">{errorText(app.listError)}{list ? ' The list below may be out of date.' : ''}</span>
    <button class="btn btn-ghost h-8" onclick={manualRefresh}>Try again</button>
  </div>
{/if}

{#if list && !up}
  <div class="flex gap-3 rounded-xl border border-off/40 bg-off-soft px-4 py-3 text-sm">
    <Icon name="power" size={18} class="mt-0.5 shrink-0 text-off" />
    <div>
      <div class="font-medium">Interface {list.interface.name} is down</div>
      <div class="text-ink-2">
        No client can connect. Start it on the server with <code class="font-mono text-[13px]">sudo systemctl start wg-quick@{list.interface.name}</code>.
      </div>
    </div>
  </div>
{/if}

{#if list?.warnings.length}
  <div class="rounded-xl border border-warn-line bg-warn-soft px-4 py-3 text-sm">
    <div class="mb-1 flex items-center gap-2 font-medium text-warn">
      <Icon name="alert" size={16} /> The host reported {list.warnings.length === 1 ? 'a warning' : `${list.warnings.length} warnings`}
    </div>
    <ul class="flex flex-col gap-0.5 pl-6 text-ink-2">
      {#each list.warnings as w}<li class="list-disc break-words">{w}</li>{/each}
    </ul>
  </div>
{/if}

{#if !list && !app.listError && !app.hostError}
  <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
    {#each Array(6) as _}
      <div class="h-36 animate-pulse rounded-xl border border-line bg-surface"></div>
    {/each}
  </div>
{:else if !list}
  <div class="rounded-xl border border-dashed border-line px-6 py-14 text-center text-sm text-ink-3">
    No client list yet. It appears here as soon as WG Manager can reach the server.
  </div>
{:else if list && clients.length === 0}
  <div class="flex flex-col items-center gap-3 rounded-xl border border-dashed border-line px-6 py-14 text-center">
    <div class="font-medium">No clients yet</div>
    <button class="btn btn-primary" disabled={!up || !!app.hostError} onclick={() => (app.adding = true)}><Icon name="plus" size={16} /> Add client</button>
  </div>
{:else if list && shown.length === 0}
  <div class="flex flex-col items-center gap-3 rounded-xl border border-dashed border-line px-6 py-14 text-center">
    <div class="font-medium">No clients match '{app.search.trim()}'</div>
    <button class="btn btn-ghost" onclick={clearSearch}>Clear</button>
  </div>
{:else if list && app.layout === 'cards'}
  <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
    {#each shown as client (client.name)}
      <ClientCard {client} />
    {/each}
  </div>
{:else if list}
  <div class="overflow-x-auto rounded-xl border border-line bg-surface shadow-card">
    <table class="w-full min-w-[640px] text-left text-sm">
      <thead class="border-b border-line text-xs text-ink-3">
        <tr>
          {@render head('name', 'py-2.5 pr-3 pl-4')}
          {@render head('address', 'px-3 py-2.5')}
          {@render head('handshake', 'px-3 py-2.5')}
          {@render head('download', 'px-3 py-2.5 text-right', true)}
          {@render head('upload', 'py-2.5 pr-4 pl-3 text-right', true)}
        </tr>
      </thead>
      <tbody class="tabular">
        {#each shown as c (c.name)}
          {@const st = status(c, up)}
          {@const conn = connection(c, app.now)}
          <tr
            class="cursor-pointer border-b border-line last:border-0 hover:bg-surface-2 {c.manageable ? '' : 'text-ink-3'}
              {app.selected === c.name ? 'bg-accent-soft' : ''}"
            onclick={() => (app.selected = c.name)}
          >
            <td class="py-2.5 pr-3 pl-4">
              <div class="flex items-center gap-2.5">
                <StatusDot tone={c.manageable ? st.tone : 'warn'} pulse={conn?.connected} label={conn?.connected ? `${st.label}, connected now` : st.label} />
                <button class="font-medium hover:underline" onclick={(e) => { e.stopPropagation(); app.selected = c.name; }}>{c.name}</button>
                {#if !c.manageable}<Icon name="lock" size={14} />{/if}
                {#if app.notes[c.public_key]}
                  {@const text = app.notes[c.public_key]}
                  <span class="shrink-0 text-ink-3" title={text} role="img" aria-label="Has a note"><Icon name="note" size={14} /></span>
                {/if}
                {#if isFlagged(c.name)}<span class="rounded-full bg-warn-soft px-1.5 text-xs text-warn">Check</span>{/if}
                {#if app.pending[c.name]}<span class="size-3 animate-spin rounded-full border-2 border-accent border-t-transparent"></span>{/if}
              </div>
            </td>
            <td class="px-3 py-2.5 font-mono text-[13px]">{c.address}</td>
            <td class="px-3 py-2.5 {conn?.connected ? 'text-live' : 'text-ink-2'}">
              {#if !c.live}<span class="text-ink-3">{st.label}</span>
              {:else if c.latest_handshake}{ago(c.latest_handshake, app.now)}
              {:else}<span class="text-ink-3">None since start</span>{/if}
            </td>
            <td class="px-3 py-2.5 text-right text-ink-2">{c.live ? bytes(c.transfer_tx) : '—'}</td>
            <td class="py-2.5 pr-4 pl-3 text-right text-ink-2">{c.live ? bytes(c.transfer_rx) : '—'}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

{#snippet head(key, cls, right = false)}
  {@const active = app.sort.key === key}
  <th class="{cls} font-medium" aria-sort={active ? (app.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
    <button
      class="inline-flex items-center gap-1 hover:text-ink {active ? 'text-ink' : ''} {right ? 'flex-row-reverse' : ''}"
      onclick={() => setSort(nextSort(app.sort, key))}
    >
      {SORT_KEYS[key].label}
      <Icon name={active && app.sort.dir === 'desc' ? 'down' : 'up'} size={12} class={active ? '' : 'invisible'} />
    </button>
  </th>
{/snippet}

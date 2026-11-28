<script>
  import Icon from '../components/Icon.svelte';
  import StatusMark from '../components/StatusMark.svelte';
  import ClientCard from '../components/ClientCard.svelte';
  import { app, refresh, connect, savePrefs, isFlagged } from '../lib/store.svelte.js';
  import { bytes, status, clientState, STATE_LABEL, connection, handshakeTime, ago, errorText } from '../lib/format.js';
  import { SORT_KEYS, sortClients, nextSort } from '../lib/sort.js';
  import { filterClients, normalizeQuery } from '../lib/filter.js';
  import { slide } from 'svelte/transition';

  let list = $derived(app.list);
  let clients = $derived(list?.clients ?? []);
  let up = $derived(list?.interface.up ?? true);
  let sorted = $derived(sortClients(clients, app.sort));
  // State per client, from the full list: the chips count these, whatever the search says.
  let states = $derived(Object.fromEntries(clients.map((c) => [c.name, clientState(c, up, app.now)])));
  let counts = $derived.by(() => {
    const n = { all: clients.length, connected: 0, idle: 0, off: 0, attention: 0, readonly: 0 };
    for (const c of clients) n[states[c.name]]++;
    return n;
  });
  // "Needs a look" and "Read-only" only get a chip while there is something to show
  // (or while one is selected, so a filter can always be turned off).
  let chips = $derived(
    ['all', 'connected', 'idle', 'off', 'attention', 'readonly'].filter(
      (k) => ['all', 'connected', 'idle', 'off'].includes(k) || counts[k] > 0 || app.filter === k,
    ),
  );
  // Search and filter change what is shown only; counts, links and the panel use the full list.
  let filtering = $derived(normalizeQuery(app.search) !== '' || app.filter !== 'all');
  let byState = $derived(app.filter === 'all' ? sorted : sorted.filter((c) => states[c.name] === app.filter));
  let shown = $derived(filterClients(byState, app.search, app.notes));

  // The sort tray is only for cards (the list sorts from its column headers).
  let sortOpen = $state(false);
  let showSearch = $derived(clients.length > 1 || filtering);
  let showSort = $derived(app.layout === 'cards' && clients.length > 1);

  function clearFilters() {
    app.search = '';
    app.filter = 'all';
  }
  let refreshing = $state(false);

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
      <div class="-ml-2 flex flex-wrap gap-x-1 gap-y-0.5" role="group" aria-label="Show clients that are">
        {#each chips as key}
          <button
            class="inline-flex h-[30px] items-center gap-2 rounded-md px-2 text-sm transition-colors
              {app.filter === key ? 'bg-surface font-medium text-ink ring-1 ring-line ring-inset' : 'text-ink-2 hover:bg-sunken hover:text-ink'}"
            aria-pressed={app.filter === key}
            onclick={() => (app.filter = key)}
          >
            {#if key !== 'all'}<span class="-mx-0.5"><StatusMark state={key} still quiet /></span>{/if}
            {key === 'all' ? 'All' : STATE_LABEL[key]}
            <span class="tabular text-ink-3">{counts[key]}</span>
          </button>
        {/each}
      </div>
    {/if}
  </div>

  <div class="flex flex-wrap items-center gap-2">
    {#if list && showSearch}
      <div class="relative">
        <Icon name="search" size={16} class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-3" />
        <input
          bind:value={app.search}
          type="search"
          class="field h-9! pl-9! sm:w-[290px]!"
          placeholder="Search name, address or note"
          aria-label="Search clients by name, address or note"
          autocomplete="off"
          spellcheck="false"
        />
      </div>
    {/if}
    {#if list && showSort}
      <button
        class="btn btn-ghost px-2.5 {sortOpen ? 'border-ink-3! bg-sunken!' : ''}"
        onclick={() => (sortOpen = !sortOpen)}
        aria-expanded={sortOpen}
        aria-controls={sortOpen ? 'clients-tray' : undefined}
        aria-label="Sort"
        title="Sort"
      >
        <Icon name="sort" size={16} />
      </button>
    {/if}
    <div class="flex rounded-md border border-edge bg-surface p-0.5" role="group" aria-label="Layout">
      <button
        class="grid size-8 place-items-center rounded-[4px] {app.layout === 'cards' ? 'bg-sunken text-ink' : 'text-ink-3 hover:text-ink'}"
        aria-pressed={app.layout === 'cards'}
        aria-label="Cards"
        title="Cards"
        onclick={() => setLayout('cards')}><Icon name="grid" size={16} /></button>
      <button
        class="grid size-8 place-items-center rounded-[4px] {app.layout === 'list' ? 'bg-sunken text-ink' : 'text-ink-3 hover:text-ink'}"
        aria-pressed={app.layout === 'list'}
        aria-label="List"
        title="List"
        onclick={() => setLayout('list')}><Icon name="list" size={16} /></button>
    </div>
    <button
      class="btn btn-primary"
      disabled={!up || !list || !!app.hostError}
      title={app.hostError ? 'Changes are paused until the server can be reached' : !up ? 'The interface is down, so a new client could not go live' : undefined}
      onclick={() => (app.adding = true)}
    >
      <Icon name="plus" size={16} class="translate-y-px" /> Add client
    </button>
  </div>
</header>

{#if list && sortOpen && showSort}
  <div id="clients-tray" class="-mt-2 rounded-xl border border-edge bg-surface p-3" transition:slide={{ duration: 150 }}>
    <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm" role="group" aria-label="Sort by">
      <span class="font-semibold text-ink">Sort by</span>
      {#each Object.keys(SORT_KEYS) as key}
        {@const active = app.sort.key === key}
        <button
          class="inline-flex min-h-6 items-center gap-1 {active ? 'font-medium text-accent' : 'text-ink-2 hover:text-ink'}"
          aria-pressed={active}
          aria-label={active ? `${SORT_KEYS[key].label}, ${app.sort.dir === 'asc' ? 'ascending' : 'descending'}, click to reverse` : SORT_KEYS[key].label}
          onclick={() => setSort(nextSort(app.sort, key))}
        >
          {SORT_KEYS[key].label}
          {#if active}<Icon name={app.sort.dir === 'asc' ? 'up' : 'down'} size={13} />{/if}
        </button>
      {/each}
    </div>
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
    <div class="mb-1 flex items-center gap-2 font-medium text-warn-text">
      <Icon name="alert" size={16} /> The host reported {list.warnings.length === 1 ? 'a warning' : `${list.warnings.length} warnings`}
    </div>
    <ul class="flex flex-col gap-0.5 pl-6 text-ink-2">
      {#each list.warnings as w}<li class="list-disc break-words">{w}</li>{/each}
    </ul>
  </div>
{/if}

{#if !list && !app.listError && !app.hostError}
  <div class="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
    {#each Array(6) as _}
      <div class="h-36 animate-pulse rounded-xl border border-edge bg-surface"></div>
    {/each}
  </div>
{:else if !list}
  <div class="rounded-xl border border-dashed border-edge px-6 py-14 text-center text-sm text-ink-3">
    No client list yet. It appears here as soon as WG Manager can reach the server.
  </div>
{:else if list && clients.length === 0}
  <div class="flex flex-col items-center gap-3 rounded-xl border border-dashed border-edge px-6 py-14 text-center">
    <div class="font-medium">No clients yet</div>
    <button class="btn btn-primary" disabled={!up || !!app.hostError} onclick={() => (app.adding = true)}><Icon name="plus" size={16} class="translate-y-px" /> Add client</button>
  </div>
{:else if list && shown.length === 0}
  <div class="flex flex-col items-center gap-3 rounded-xl border border-dashed border-edge px-6 py-14 text-center">
    <div class="font-medium">
      {#if normalizeQuery(app.search)}No clients match '{app.search.trim()}'{:else}No {STATE_LABEL[app.filter].toLowerCase()} clients{/if}
    </div>
    <button class="btn btn-ghost" onclick={clearFilters}>{normalizeQuery(app.search) && app.filter !== 'all' ? 'Clear search and filter' : 'Clear'}</button>
  </div>
{:else if list && app.layout === 'cards'}
  <div class="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
    {#each shown as client (client.name)}
      <ClientCard {client} />
    {/each}
  </div>
{:else if list}
  <!-- The bar in "Last seen" needs room: below 780px of list width only the time shows. -->
  <div class="@container">
    <div class="overflow-x-auto rounded-xl border border-edge bg-surface">
      <table class="w-full min-w-[640px] text-left text-sm">
        <thead class="border-b border-line text-[13px] text-ink-3">
          <tr>
            {@render head('name', 'py-2 pr-3 pl-4')}
            {@render head('address', 'px-3 py-2')}
            {@render head('handshake', 'px-3 py-2')}
            {@render head('download', 'px-3 py-2 text-right', true)}
            {@render head('upload', 'py-2 pr-4 pl-3 text-right', true)}
          </tr>
        </thead>
        <tbody class="tabular">
          {#each shown as c (c.name)}
            {@const conn = connection(c, app.now)}
            {@const state = states[c.name]}
            <tr
              class="cursor-pointer border-b border-line last:border-0 hover:bg-surface-2 {c.manageable ? '' : 'text-ink-3'}
                {app.selected === c.name ? 'bg-accent-soft' : ''}"
              onclick={() => (app.selected = c.name)}
            >
              <td class="py-2.5 pr-3 pl-4">
                <div class="flex items-center gap-1.5">
                  <StatusMark {state} label={c.manageable ? undefined : 'Managed outside wgmanager'} />
                  <button class="font-medium hover:underline" onclick={(e) => { e.stopPropagation(); app.selected = c.name; }}>{c.name}</button>
                  {#if app.notes[c.public_key]}
                    {@const text = app.notes[c.public_key]}
                    <span class="shrink-0 text-ink-3" title={text} role="img" aria-label="Has a note"><Icon name="note" size={14} /></span>
                  {/if}
                  {#if isFlagged(c.name)}<span class="rounded-full bg-warn-soft px-1.5 text-xs text-warn-text">Check</span>{/if}
                  {#if app.pending[c.name]}<span class="size-3 animate-spin rounded-full border-2 border-accent border-t-transparent"></span>{/if}
                </div>
              </td>
              <td class="px-3 py-2.5 font-mono text-[13px]">{c.address}</td>
              <td class="px-3 py-2.5">
                <div class="flex items-center gap-3.5">
                  <div class="hidden h-1 w-[120px] shrink-0 overflow-hidden rounded-full bg-sunken @min-[780px]:block" aria-hidden="true">
                    {#if conn?.connected}<div class="h-full rounded-full bg-live" style="width: {Math.round(conn.elapsed * 100)}%"></div>{/if}
                  </div>
                  <span class="min-w-[5.5em] {conn?.connected ? 'text-live-text' : 'text-ink-2'}" title={handshakeTime(c.latest_handshake)}>
                    {#if !c.live}<span class="text-ink-3">{status(c, up).label}</span>
                    {:else if c.latest_handshake}{ago(c.latest_handshake, app.now)}
                    {:else}<span class="text-ink-3">Not seen since start</span>{/if}
                  </span>
                </div>
              </td>
              <td class="px-3 py-2.5 text-right text-ink-2">{c.live ? bytes(c.transfer_tx) : '—'}</td>
              <td class="py-2.5 pr-4 pl-3 text-right text-ink-2">{c.live ? bytes(c.transfer_rx) : '—'}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
{/if}

{#snippet head(key, cls, right = false)}
  {@const active = app.sort.key === key}
  <th class="{cls} font-medium" aria-sort={active ? (app.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
    <button
      class="inline-flex min-h-6 items-center gap-1 hover:text-ink {active ? 'text-ink' : ''} {right ? 'flex-row-reverse' : ''}"
      onclick={() => setSort(nextSort(app.sort, key))}
    >
      {SORT_KEYS[key].label}
      <Icon name={active && app.sort.dir === 'desc' ? 'down' : 'up'} size={12} class={active ? '' : 'invisible'} />
    </button>
  </th>
{/snippet}

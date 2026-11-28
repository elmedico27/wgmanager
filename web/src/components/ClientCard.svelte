<script>
  import Icon from './Icon.svelte';
  import StatusMark from './StatusMark.svelte';
  import SessionMeter from './SessionMeter.svelte';
  import { app, isFlagged } from '../lib/store.svelte.js';
  import { bytes, status, clientState, unmanageableReason, isSafeName } from '../lib/format.js';

  let { client } = $props();
  let ifaceUp = $derived(app.list?.interface.up);
  let st = $derived(status(client, ifaceUp));
  let state = $derived(clientState(client, ifaceUp, app.now));
  let pending = $derived(app.pending[client.name]);
  let flagged = $derived(isFlagged(client.name));
  let selected = $derived(app.selected === client.name);
  let note = $derived(app.notes[client.public_key]);
  const pendingWord = { enable: 'Enabling', disable: 'Disabling', remove: 'Deleting', add: 'Adding' };
</script>

{#if client.manageable}
  <button
    class="group flex min-w-0 flex-col gap-4 rounded-xl border bg-surface p-4 text-left transition-colors duration-150
      {selected ? 'border-accent ring-2 ring-accent-soft' : flagged ? 'border-warn-line' : 'border-edge hover:border-ink-3'}"
    onclick={() => (app.selected = client.name)}
    aria-haspopup="dialog"
  >
    <div class="flex items-start gap-2">
      <div class="pt-[5px]"><StatusMark {state} quiet /></div>
      <div class="min-w-0 flex-1">
        <div class="flex min-w-0 items-center gap-1.5">
          <span class="truncate font-semibold">{client.name}</span>
          {#if note}{@render noteMark(note)}{/if}
        </div>
        <div class="font-mono text-[13px] text-ink-2">{client.address}</div>
      </div>
      {#if pending}
        <span class="flex items-center gap-1.5 rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent">
          <span class="size-3 animate-spin rounded-full border-2 border-current border-t-transparent"></span>
          {pendingWord[pending]}…
        </span>
      {:else if flagged}
        <span class="flex items-center gap-1 rounded-full bg-warn-soft px-2 py-0.5 text-xs font-medium text-warn-text">
          <Icon name="alert" size={13} /> Check
        </span>
      {:else}
        <Icon name="chevron" size={16} class="mt-1 text-ink-3 opacity-0 transition-opacity group-hover:opacity-100" />
      {/if}
    </div>

    {#if client.live}
      {#if st.tone === 'warn'}<div class="-mb-2 text-[13px] text-warn-text">{st.label}</div>{/if}
      <SessionMeter {client} now={app.now} />
    {:else}
      <div class="flex flex-col gap-1.5">
        <div class="text-[13px] {st.tone === 'off' ? 'text-ink-3' : 'text-warn-text'}">{st.label}</div>
        <div class="h-1 rounded-full bg-sunken" aria-hidden="true"></div>
      </div>
    {/if}

    <div class="tabular flex gap-5 border-t border-line pt-3 text-[13px] {client.live ? 'text-ink-2' : 'text-ink-3'}">
      <span class="flex items-center gap-1.5" title="Downloaded by the client">
        <Icon name="down" size={14} class="text-ink-3" /><span class="sr-only">Downloaded </span>{client.live ? bytes(client.transfer_tx) : '—'}
      </span>
      <span class="flex items-center gap-1.5" title="Uploaded by the client">
        <Icon name="up" size={14} class="text-ink-3" /><span class="sr-only">Uploaded </span>{client.live ? bytes(client.transfer_rx) : '—'}
      </span>
    </div>
  </button>
{:else}
  <button
    class="flex min-w-0 flex-col gap-3 rounded-xl border border-dashed bg-surface-2 p-4 text-left transition-[border-color,opacity] duration-150 hover:opacity-100
      {selected ? 'border-accent opacity-100 ring-2 ring-accent-soft' : 'border-edge opacity-75 hover:border-ink-3'}"
    onclick={() => (app.selected = client.name)}
    aria-haspopup="dialog"
  >
    <div class="flex items-start gap-2">
      <div class="pt-[5px]"><StatusMark state="readonly" label="Managed outside wgmanager" quiet /></div>
      <div class="min-w-0 flex-1">
        <div class="flex min-w-0 items-center gap-1.5">
          <span class="truncate font-semibold text-ink-2">{client.name}</span>
          {#if note}{@render noteMark(note)}{/if}
        </div>
        <div class="font-mono text-[13px] text-ink-3">{client.address}</div>
      </div>
    </div>
    <p class="text-[13px] text-ink-2">{unmanageableReason(client, isSafeName)}</p>
  </button>
{/if}

{#snippet noteMark(text)}
  <span class="shrink-0 text-ink-3" title={text} role="img" aria-label="Has a note"><Icon name="note" size={14} /></span>
{/snippet}

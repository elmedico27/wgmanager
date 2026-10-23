<script>
  // QR code and config text for one client. Nothing is fetched until the admin
  // asks for it, because both contain the client's private key.
  import { copyText, COPY_FAILED } from '../lib/clipboard.js';
  import Icon from './Icon.svelte';
  import { api, MOCK } from '../lib/api.js';
  import { errorText } from '../lib/format.js';
  import { notify } from '../lib/store.svelte.js';
  import { onDestroy, untrack } from 'svelte';

  let { name, config: given = null, open = null } = $props();

  let mode = $state(untrack(() => open)); // null | 'qr' | 'text'
  let qr = $state(null);
  let text = $state(untrack(() => given));
  let error = $state(null);
  let loading = $state(false);

  $effect(() => {
    if (mode === 'qr' && !qr) loadQr();
    if (mode === 'text' && !text) loadText();
  });

  async function loadQr() {
    loading = true;
    error = null;
    const r = await api.qr(name);
    if (r.ok) qr = r.url;
    else error = errorText(r.error);
    loading = false;
  }

  async function loadText() {
    loading = true;
    error = null;
    const r = await api.config(name);
    if (r.ok) text = r.data.config;
    else error = errorText(r.error);
    loading = false;
  }

  let downloading = $state(false);
  async function download() {
    // Fetched first, so a failure shows here instead of navigating away.
    downloading = true;
    const r = await api.download(name);
    downloading = false;
    if (!r.ok) {
      notify(`Could not download ${name}.conf. ${errorText(r.error)}`);
      return;
    }
    const url = URL.createObjectURL(r.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.conf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    if (MOCK) notify('Download started. Some preview viewers block downloads; the real app sends the file from the server.');
  }

  async function copy() {
    notify((await copyText(text)) ? 'Config copied' : COPY_FAILED);
  }

  onDestroy(() => {
    if (qr?.startsWith('blob:')) URL.revokeObjectURL(qr);
  });
</script>

<div class="flex flex-col gap-3">
  <div class="flex flex-wrap gap-2">
    <button class="btn {mode === 'qr' ? 'btn-primary' : 'btn-ghost'}" onclick={() => (mode = mode === 'qr' ? null : 'qr')}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2" /></svg>
      {mode === 'qr' ? 'Hide QR code' : 'Show QR code'}
    </button>
    <button class="btn {mode === 'text' ? 'btn-primary' : 'btn-ghost'}" onclick={() => (mode = mode === 'text' ? null : 'text')}>
      <Icon name={mode === 'text' ? 'eyeoff' : 'eye'} size={16} />
      {mode === 'text' ? 'Hide config' : 'View config'}
    </button>
    <button class="btn btn-ghost" onclick={download} disabled={downloading}>
      <Icon name="download" size={16} /> {downloading ? 'Preparing…' : `Download ${name}.conf`}
    </button>
  </div>

  {#if mode}
    <div class="rounded-xl border border-line bg-surface-2 p-3">
      {#if loading}
        <div class="grid h-40 place-items-center text-sm text-ink-3">Loading…</div>
      {:else if error}
        <div class="flex flex-col items-start gap-2 text-sm">
          <span class="text-off">{error}</span>
          <button class="btn btn-ghost h-8" onclick={() => (mode === 'qr' ? loadQr() : loadText())}>Try again</button>
        </div>
      {:else if mode === 'qr' && qr}
        <div class="flex flex-col items-center gap-2">
          <img src={qr} alt="QR code with the WireGuard config for {name}" class="aspect-square w-full max-w-64 rounded-lg bg-white p-2" />
          <p class="text-center text-xs text-ink-3">Scan with the WireGuard app: Add tunnel, then Scan from QR code.</p>
        </div>
      {:else if mode === 'text' && text}
        <div class="relative">
          <pre class="max-h-72 overflow-auto rounded-lg bg-sunken p-3 font-mono text-[12.5px] leading-relaxed whitespace-pre text-ink">{text}</pre>
          <button class="btn btn-ghost absolute top-2 right-2 h-7 px-2 text-xs" onclick={copy}><Icon name="copy" size={14} /> Copy</button>
        </div>
      {/if}
      <p class="mt-3 flex items-center gap-1.5 text-xs text-ink-3">
        <Icon name="key" size={13} /> Contains this client's private key. Anyone with it can connect as {name}.
      </p>
    </div>
  {/if}
</div>

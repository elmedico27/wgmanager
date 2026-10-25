<script>
  // The app's own SSH public key and the exact install command for the host.
  import { copyText, COPY_FAILED } from '../lib/clipboard.js';
  import Icon from './Icon.svelte';
  import { app, notify } from '../lib/store.svelte.js';

  let s = $derived(app.settings);
  // The host tool ships inside the image; copy it out as root, then run it.
  // /opt/wgmanager/host is where the Dockerfile puts it; `wgmanager` is the
  // container_name in compose.yaml.
  const TOOL_DIR = '/usr/local/lib/wgmanager';
  let command = $derived(
    s
      ? `sudo docker cp wgmanager:/opt/wgmanager/host/. ${TOOL_DIR} && \\\n  sudo python3 ${TOOL_DIR}/wgmanager-host install --pubkey "${s.publicKey}"`
      : '',
  );

  async function copy(text, what) {
    notify((await copyText(text)) ? `${what} copied` : COPY_FAILED);
  }
</script>

{#if s}
  <div class="flex flex-col gap-4">
    <div class="flex flex-col gap-1.5">
      <div class="flex items-center justify-between text-sm">
        <span class="font-medium">Install helper and app key</span>
        <button class="flex items-center gap-1 text-xs text-accent hover:underline" onclick={() => copy(command, 'Command')}><Icon name="copy" size={13} /> Copy</button>
      </div>
      <pre class="overflow-x-auto rounded-lg bg-sunken p-3 font-mono text-[12.5px] leading-relaxed whitespace-pre text-ink">{command}</pre>
      <p class="text-xs text-ink-3">If a different key is already installed, add <code class="font-mono">--replace-key</code>.</p>
    </div>

    <div class="flex flex-col gap-1.5">
      <div class="flex items-center justify-between text-sm">
        <span class="font-medium">This app's public key</span>
        <button class="flex items-center gap-1 text-xs text-accent hover:underline" onclick={() => copy(s.publicKey, 'Public key')}><Icon name="copy" size={13} /> Copy</button>
      </div>
      <div class="rounded-lg border border-line bg-surface-2 p-3 font-mono text-[12.5px] break-all text-ink-2 select-all">{s.publicKey}</div>
    </div>
  </div>
{/if}

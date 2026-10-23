<script>
  // The app's own SSH public key and the exact install command for the host.
  import Icon from './Icon.svelte';
  import { app, notify } from '../lib/store.svelte.js';

  let s = $derived(app.settings);
  // The host tool ships inside the image; copy it out as root, then run it.
  // Paths unverified until the Dockerfile exists (image layout /opt/wgmanager).
  const TOOL_DIR = '/usr/local/lib/wgmanager';
  let command = $derived(
    s
      ? `sudo docker cp wgmanager:/opt/wgmanager/host/. ${TOOL_DIR} && \\\n  sudo python3 ${TOOL_DIR}/wgmanager-host install --pubkey "${s.publicKey}"`
      : '',
  );

  async function copy(text, what) {
    try {
      await navigator.clipboard.writeText(text);
      notify(`${what} copied`);
    } catch {
      notify('Copy was blocked. Select the text and copy it instead.');
    }
  }
</script>

{#if s}
  <div class="flex flex-col gap-4">
    <div class="flex flex-col gap-1.5">
      <div class="flex items-center justify-between text-sm">
        <span class="font-medium">Run this on the WireGuard server</span>
        <button class="flex items-center gap-1 text-xs text-accent hover:underline" onclick={() => copy(command, 'Command')}><Icon name="copy" size={13} /> Copy</button>
      </div>
      <pre class="overflow-x-auto rounded-lg bg-sunken p-3 font-mono text-[12.5px] leading-relaxed whitespace-pre text-ink">{command}</pre>
      <p class="text-xs text-ink-3">
        It copies the host tool out of this container into <code class="font-mono">{TOOL_DIR}</code>, then installs the
        helper and lets this app's key in, only from {s.allowFrom.join(', ')}. It shows its plan and asks before changing
        anything, and its last line is the server's fingerprint for the next step. If a different key is already
        installed, add <code class="font-mono">--replace-key</code>.
      </p>
    </div>

    <div class="flex flex-col gap-1.5">
      <div class="flex items-center justify-between text-sm">
        <span class="font-medium">This app's public key</span>
        <button class="flex items-center gap-1 text-xs text-accent hover:underline" onclick={() => copy(s.publicKey, 'Public key')}><Icon name="copy" size={13} /> Copy</button>
      </div>
      <div class="rounded-lg border border-line bg-surface-2 p-3 font-mono text-[12.5px] break-all text-ink-2 select-all">{s.publicKey}</div>
      <p class="text-xs text-ink-3">Made by this container on first start. The private half never leaves its volume.</p>
    </div>
  </div>
{/if}

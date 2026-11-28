<script>
  // Shows how far into the 180 s session window (REJECT_AFTER_TIME) a client is
  // since its last handshake. Empty right after a handshake, fills as the
  // session ages; a connected client re-handshakes about every 2 minutes.
  import { connection, handshakeTime } from '../lib/format.js';
  let { client, now } = $props();
  let conn = $derived(connection(client, now));
  let width = $derived(conn?.connected ? Math.round(conn.elapsed * 100) : 0);
  // The bar eases as it fills, but jumps back to empty on the next handshake.
  let previous = 0;
  let resetting = $state(false);
  $effect.pre(() => {
    resetting = width < previous;
    previous = width;
  });
</script>

{#if conn}
  <div class="flex flex-col gap-1.5">
    <div class="flex items-baseline justify-between gap-3 text-[13px]">
      {#if conn.connected}
        <span class="font-medium text-live-text">Connected</span>
      {:else}
        <span class="text-ink-2">Idle</span>
      {/if}
      <span class="tabular text-right text-ink-3" title={handshakeTime(client.latest_handshake)}>{conn.text}</span>
    </div>
    <div class="h-1 overflow-hidden rounded-full bg-sunken" aria-hidden="true">
      {#if conn.connected}
        <div class="h-full rounded-full bg-live {resetting ? '' : 'transition-[width] duration-1000 ease-linear'}" style="width: {width}%"></div>
      {/if}
    </div>
  </div>
{/if}

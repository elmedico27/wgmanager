<script>
  // Shows how much of the 180 s session window (REJECT_AFTER_TIME) is left
  // since the last handshake. Full right after a handshake, drains to empty.
  import { connection } from '../lib/format.js';
  let { client, now } = $props();
  let conn = $derived(connection(client, now));
</script>

{#if conn}
  <div class="flex flex-col gap-1.5">
    <div class="flex items-baseline justify-between gap-3 text-[13px]">
      {#if conn.connected}
        <span class="font-medium text-live">Connected now</span>
      {:else}
        <span class="text-ink-2">Idle</span>
      {/if}
      <span class="tabular truncate text-ink-3">{conn.text}</span>
    </div>
    <div class="h-1 overflow-hidden rounded-full bg-sunken" aria-hidden="true">
      {#if conn.connected}
        <div class="h-full rounded-full bg-live transition-[width] duration-1000 ease-linear" style="width: {Math.round(conn.remaining * 100)}%"></div>
      {/if}
    </div>
  </div>
{/if}

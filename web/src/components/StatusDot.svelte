<script>
  let { tone, pulse = false } = $props();
  const color = { live: 'bg-live', off: 'bg-off', warn: 'bg-warn' };
</script>

<span class="relative inline-flex size-2.5 shrink-0">
  {#if pulse}
    <span class="absolute inset-0 animate-ping rounded-full {color[tone]} opacity-40" style="animation-duration: 2.4s"></span>
  {/if}
  <span class="relative inline-flex size-2.5 rounded-full {color[tone]}"></span>
</span>

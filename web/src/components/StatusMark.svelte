<script>
  // A client's state as a small mark. Shape carries the meaning as well as color:
  //   connected  solid green dot, pulsing
  //   idle       green ring
  //   off        grey ring with a dash
  //   attention  solid amber dot
  //   readonly   amber lock
  // Every mark sits in a 16px slot so names line up whichever mark they have.
  // `quiet` hides it from screen readers where the same state is already in text.
  import Icon from './Icon.svelte';
  import { STATE_LABEL } from '../lib/format.js';

  let { state, label = undefined, quiet = false, still = false } = $props();
  let name = $derived(label ?? STATE_LABEL[state]);
</script>

<span
  class="mark inline-flex h-4 w-4 shrink-0 items-center justify-center"
  title={name}
  role={quiet ? undefined : 'img'}
  aria-label={quiet ? undefined : name}
  aria-hidden={quiet ? 'true' : undefined}
>
  {#if state === 'readonly'}
    <Icon name="lock" size={16} class="text-warn" />
  {:else if state === 'connected'}
    <span class="relative inline-flex size-2.5">
      {#if !still}<span class="absolute inset-0 animate-ping rounded-full bg-live opacity-40" style="animation-duration: 2.4s"></span>{/if}
      <span class="relative inline-flex size-2.5 rounded-full bg-live"></span>
    </span>
  {:else if state === 'idle'}
    <span class="size-2.5 rounded-full border-[1.5px] border-live"></span>
  {:else if state === 'off'}
    <span class="relative size-2.5 rounded-full border-[1.5px] border-ink-3">
      <span class="absolute inset-x-px top-[2.9px] h-[1.25px] bg-ink-3"></span>
    </span>
  {:else}
    <span class="size-2.5 rounded-full bg-warn"></span>
  {/if}
</span>

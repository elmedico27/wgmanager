<script>
  // The WG Manager mark: two linked rings, drawn in the current text color.
  let { size = 32, class: cls = '' } = $props();
</script>

<svg class={cls} width={size} height={(size * 22) / 30} viewBox="0 0 30 22" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true">
  <circle cx="9.5" cy="11" r="6.2" />
  <circle cx="20.5" cy="11" r="6.2" />
</svg>

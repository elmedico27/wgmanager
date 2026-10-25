<script>
  // Shown for any address that isn't a page of the app. Always in the dark
  // theme (App.svelte), whatever the viewer's theme setting, and needs no sign-in.
</script>

<div class="gutter grid min-h-dvh place-items-center bg-bg py-10">
  <div class="flex flex-col items-center gap-5 text-center">
    <svg width="44" height="44" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <circle cx="10" cy="16" r="3.2" fill="none" stroke="var(--on-accent)" stroke-width="2" />
      <circle cx="22" cy="16" r="3.2" fill="none" stroke="var(--on-accent)" stroke-width="2" />
      <path d="M13.2 13.5h5.6M13.2 18.5h5.6" stroke="var(--on-accent)" stroke-width="2" stroke-linecap="round" />
    </svg>
    <h1 class="text-xl font-semibold text-ink">Page not found</h1>
    <a class="btn btn-primary" href="/">Back to WG Manager</a>
  </div>
</div>

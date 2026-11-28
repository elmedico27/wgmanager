<script>
  import Logo from '../components/Logo.svelte';
  // Shown for any address that isn't a page of the app. Always in the dark
  // theme (App.svelte), whatever the viewer's theme setting, and needs no sign-in.
</script>

<div class="gutter grid min-h-dvh place-items-center bg-bg py-10">
  <div class="flex flex-col items-center gap-5 text-center">
    <Logo size={52} class="text-ink" />
    <h1 class="text-xl font-semibold text-ink">Page not found</h1>
    <a class="btn btn-primary" href="/">Back to WG Manager</a>
  </div>
</div>

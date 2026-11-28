<script>
  import Logo from '../components/Logo.svelte';
  import { app, login } from '../lib/store.svelte.js';
  import { MOCK, DEMO } from '../lib/api.js';
  import { errorText } from '../lib/format.js';

  let password = $state('');
  let error = $state(null);
  let busy = $state(false);

  async function submit(e) {
    e.preventDefault();
    if (!password || busy) return;
    busy = true;
    error = null;
    const r = await login(password);
    busy = false;
    if (!r.ok) {
      error = r.error.code === 'bad_login' ? 'That password is not right.' : errorText(r.error);
      password = '';
    }
  }
</script>

<div class="gutter grid min-h-dvh place-items-center bg-rail py-10">
  <div class="flex w-full max-w-sm flex-col gap-8">
    <div class="flex flex-col items-center gap-3 text-center">
      <Logo size={52} class="text-white" />
      <h1 class="text-xl font-semibold text-white">WG Manager</h1>
    </div>

    <form class="flex flex-col gap-4 rounded-2xl bg-surface p-6 shadow-lift" onsubmit={submit}>
      {#if app.signedOutNotice}
        <p class="rounded-lg bg-surface-2 px-3 py-2.5 text-sm text-ink-2">{app.signedOutNotice}</p>
      {/if}
      <div class="flex flex-col gap-1.5">
        <label for="login-password" class="text-sm font-medium">Admin password</label>
        <!-- svelte-ignore a11y_autofocus -->
        <input id="login-password" type="password" class="field" bind:value={password} autocomplete="current-password" autofocus />
        {#if DEMO}
          <span class="text-xs text-ink-3">Demo: any password works. Nothing here connects to a real server.</span>
        {:else if MOCK}
          <span class="text-xs text-ink-3">Preview: any password works.</span>
        {/if}
      </div>
      {#if error}<p class="text-sm text-off" role="alert">{error}</p>{/if}
      <button class="btn btn-primary h-10" disabled={!password || busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
    </form>

    <p class="text-center text-xs text-rail-ink-2">
      Forgot it? On the server, run <code class="font-mono text-rail-ink">docker exec wgmanager wgmanager reset-password</code>.
      It signs everyone out and prints a new setup code.
    </p>
  </div>
</div>

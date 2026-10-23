<script>
  // First run without an admin password. The setup code is printed to the
  // container log, so only someone who can read the log can claim the app.
  import PasswordFields from '../components/PasswordFields.svelte';
  import { setup } from '../lib/store.svelte.js';
  import { MIN_PASSWORD } from '../lib/format.js';
  import { MOCK } from '../lib/api.js';

  let code = $state('');
  let password = $state('');
  let confirm = $state('');
  let busy = $state(false);
  let error = $state(null);

  let ready = $derived(code.trim() && password.length >= MIN_PASSWORD && password === confirm);

  const messages = {
    bad_code: 'That setup code is not right. Copy it again from the container log; a new one is printed each time the container starts.',
    weak_password: `Use at least ${MIN_PASSWORD} characters.`,
    already_set: 'A password is already set. Sign in instead.',
    rate_limited: 'Too many failed attempts. Wait 15 minutes and try again.',
    network: 'The WG Manager server did not answer. Check that the container is running.',
  };

  async function submit(e) {
    e.preventDefault();
    if (!ready || busy) return;
    busy = true;
    error = null;
    const r = await setup(code, password);
    busy = false;
    if (!r.ok) error = messages[r.error.code] ?? 'Could not save the password. Check the container log.';
  }
</script>

<div class="gutter grid min-h-dvh place-items-center bg-rail py-10">
  <div class="flex w-full max-w-md flex-col gap-8">
    <div class="flex flex-col items-center gap-3 text-center">
      <svg width="44" height="44" viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="var(--accent)" />
        <circle cx="10" cy="16" r="3.2" fill="none" stroke="var(--on-accent)" stroke-width="2" />
        <circle cx="22" cy="16" r="3.2" fill="none" stroke="var(--on-accent)" stroke-width="2" />
        <path d="M13.2 13.5h5.6M13.2 18.5h5.6" stroke="var(--on-accent)" stroke-width="2" stroke-linecap="round" />
      </svg>
      <h1 class="text-xl font-semibold text-white">Set up WG Manager</h1>
      <p class="text-sm text-rail-ink">Choose the admin password. You'll use it to sign in from now on.</p>
    </div>

    <form class="flex flex-col gap-4 rounded-2xl bg-surface p-6 shadow-lift" onsubmit={submit}>
      <div class="flex flex-col gap-1.5">
        <label for="setup-code" class="text-sm font-medium">Setup code</label>
        <!-- svelte-ignore a11y_autofocus -->
        <input id="setup-code" class="field font-mono tracking-wider uppercase" bind:value={code} autocomplete="off" spellcheck="false" autofocus disabled={busy} />
        <span class="text-xs text-ink-3">
          Printed in the container's log when it starts. Run <code class="font-mono">docker logs wgmanager</code> on the
          server, or open the container's logs in Arcane, Portainer or a similar tool.
          {#if MOCK}<br />Preview code: <span class="font-mono">K7QM-4XTD-92PW</span>{/if}
        </span>
      </div>

      <PasswordFields bind:password bind:confirm idPrefix="setup" disabled={busy} />

      {#if error}<p class="text-sm text-off" role="alert">{error}</p>{/if}
      <button class="btn btn-primary h-10" disabled={!ready || busy}>{busy ? 'Saving…' : 'Save password and continue'}</button>
    </form>

    <p class="text-center text-xs text-rail-ink-2">
      Forgot it later? <code class="font-mono">docker exec wgmanager wgmanager reset-password</code> on the server prints a new setup code.
    </p>
  </div>
</div>

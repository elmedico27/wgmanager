<script>
  import Icon from '../components/Icon.svelte';
  import InstallKey from '../components/InstallKey.svelte';
  import { app, connect, logout } from '../lib/store.svelte.js';
  import { api } from '../lib/api.js';
  import { errorText } from '../lib/format.js';

  let testing = $state(false);
  let pinError = $state(null);
  let rejected = $state(false);

  let ssh = $derived(app.settings?.ssh);
  let code = $derived(app.hostError?.code);
  let needsConfirm = $derived(code === 'hostkey_unconfirmed' && !!app.hostKey?.offered);
  // Why this screen is showing, in words. Shown on arrival and after each test.
  let problem = $derived(
    code === 'hostkey_unconfirmed' && !app.hostKey?.offered
      ? `Nothing answered on SSH at ${ssh?.host}:${ssh?.port}. Check that the server is on and that SSH_HOST and SSH_PORT are right, then test again.`
      : code === 'key_refused'
        ? "The server answered but does not accept this app's key yet. Run the command in step 1, then test again."
        : null,
  );

  async function test() {
    testing = true;
    pinError = null;
    rejected = false;
    await connect();
    testing = false;
  }

  async function confirmKey() {
    testing = true;
    const r = await api.pinHostKey(app.hostKey.offered.fingerprint);
    testing = false;
    if (!r.ok) {
      pinError = errorText(r.error);
      return;
    }
    await test();
  }
</script>

<div class="gutter min-h-dvh bg-bg py-10 md:py-16">
  <div class="mx-auto flex max-w-2xl flex-col gap-8">
    <header class="flex flex-col gap-2">
      <h1 class="text-2xl font-semibold tracking-tight">Connect WG Manager to your server</h1>
      <p class="text-ink-2">
        WG Manager talks to your WireGuard server over SSH, through a small helper that can only manage WireGuard
        clients. Install it once, then test the connection.
      </p>
    </header>

    <ol class="flex flex-col gap-4">
      <li class="flex gap-4 rounded-2xl border border-line bg-surface p-5 shadow-card">
        <span class="grid size-7 shrink-0 place-items-center rounded-full bg-accent-soft text-sm font-semibold text-accent">1</span>
        <div class="flex min-w-0 flex-1 flex-col gap-4">
          <h2 class="font-semibold">Install the helper on the server</h2>
          <InstallKey />
        </div>
      </li>

      <li class="flex gap-4 rounded-2xl border border-line bg-surface p-5 shadow-card">
        <span class="grid size-7 shrink-0 place-items-center rounded-full bg-accent-soft text-sm font-semibold text-accent">2</span>
        <div class="flex min-w-0 flex-1 flex-col gap-3">
          <h2 class="font-semibold">Test the connection</h2>
          {#if ssh}
            <dl class="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
              <dt class="text-ink-2">Server</dt>
              <dd><span class="font-mono">{ssh.host}</span> <span class="text-xs text-ink-3">SSH_HOST</span></dd>
              <dt class="text-ink-2">SSH port</dt>
              <dd><span class="font-mono">{ssh.port}</span> <span class="text-xs text-ink-3">SSH_PORT</span></dd>
              <dt class="text-ink-2">Account</dt>
              <dd><span class="font-mono">{ssh.user}</span> <span class="text-xs text-ink-3">SSH_USER</span></dd>
            </dl>
            <p class="text-xs text-ink-3">These come from the container's environment. Change them in your compose file if they are wrong.</p>
          {/if}

          {#if needsConfirm}
            <div class="flex flex-col gap-3 rounded-xl border border-accent/40 bg-accent-soft/50 p-4 text-sm">
              <div class="flex items-center gap-2 font-semibold"><Icon name="key" size={16} /> Confirm this is your server</div>
              <p class="text-ink-2">
                The server at <span class="font-mono">{ssh?.host}:{ssh?.port}</span> identified itself with this fingerprint.
                Compare it with the last line the install command printed.
              </p>
              <div class="rounded-lg bg-surface px-3 py-2.5 font-mono text-[13px] break-all">
                {app.hostKey.offered.fingerprint} <span class="font-sans text-xs text-ink-3">({app.hostKey.offered.type})</span>
              </div>
              {#if rejected}
                <p class="text-off">
                  Don't continue. Check that SSH_HOST and SSH_PORT point at your WireGuard server. If they do, something
                  else may be answering in its place. After fixing the settings, recreate the container and check again.
                </p>
              {/if}
              {#if pinError}<p class="text-off">{pinError}</p>{/if}
              <div class="flex flex-wrap gap-2">
                <button class="btn btn-primary" onclick={confirmKey} disabled={testing}><Icon name="check" size={16} /> It matches</button>
                {#if rejected}
                  <button class="btn btn-ghost" onclick={test} disabled={testing}>Check again</button>
                {:else}
                  <button class="btn btn-ghost" onclick={() => (rejected = true)} disabled={testing}>It doesn't match</button>
                {/if}
              </div>
              <p class="text-xs text-ink-3">
                Lost the installer output? Run <code class="font-mono">ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub</code> on the server.
              </p>
            </div>
          {:else}
            {#if problem && !testing}
              <div class="flex gap-2 rounded-lg border border-off/40 bg-off-soft px-3 py-2.5 text-sm" role="status">
                <Icon name="alert" size={16} class="mt-0.5 shrink-0 text-off" />
                <span>{problem}</span>
              </div>
            {/if}
            <div class="flex flex-wrap items-center gap-3">
              <button class="btn btn-primary" onclick={test} disabled={testing}>
                {#if testing}<span class="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"></span>{/if}
                Test connection
              </button>
              {#if testing}
                <span class="text-sm text-ink-3">Checking… this can take a few seconds.</span>
              {/if}
            </div>
          {/if}
        </div>
      </li>
    </ol>

    <button class="self-start text-sm text-ink-3 hover:text-ink" onclick={logout}>Sign out</button>
  </div>
</div>

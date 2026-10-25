<script>
  import Icon from '../components/Icon.svelte';
  import InstallKey from '../components/InstallKey.svelte';
  import PasswordFields from '../components/PasswordFields.svelte';
  import { app, savePrefs, logout, notify, connect } from '../lib/store.svelte.js';
  import { api } from '../lib/api.js';
  import { MIN_PASSWORD } from '../lib/format.js';

  let current = $state('');
  let password = $state('');
  let confirm = $state('');
  let saving = $state(false);
  let pwError = $state(null);
  let canSave = $derived(current && password.length >= MIN_PASSWORD && password === confirm && !saving);

  async function changePassword(e) {
    e.preventDefault();
    if (!canSave) return;
    saving = true;
    pwError = null;
    const r = await api.changePassword(current, password);
    saving = false;
    if (r.ok) {
      current = password = confirm = '';
      notify('Password changed. Other signed-in browsers were signed out.');
    } else {
      pwError = {
        bad_login: 'The current password is not right.',
        weak_password: `Use at least ${MIN_PASSWORD} characters.`,
        rate_limited: 'Too many failed attempts. Wait 15 minutes and try again.',
        network: 'The WG Manager server did not answer.',
      }[r.error.code] ?? 'Could not change the password.';
    }
  }

  let ssh = $derived(app.settings?.ssh);

  // Server identity (pinned SSH host key)
  let hostKey = $state(null);
  let forgetting = $state(false);
  async function loadHostKey() {
    const r = await api.hostKey();
    if (r.ok) hostKey = r.data;
  }
  loadHostKey();
  async function forget() {
    await api.forgetHostKey();
    forgetting = false;
    await connect(); // leads to the confirm step
  }
  const themes = [
    { id: 'system', label: 'Follow system', icon: 'auto' },
    { id: 'light', label: 'Light', icon: 'sun' },
    { id: 'dark', label: 'Dark', icon: 'moon' },
  ];
</script>

<header class="flex flex-col gap-1">
  <h1 class="text-2xl font-semibold tracking-tight">Settings</h1>
</header>

<section class="flex flex-col gap-4 rounded-xl border border-line bg-surface p-5 shadow-card">
  <h2 class="font-semibold">Appearance</h2>
  <div class="flex flex-wrap gap-2" role="radiogroup" aria-label="Theme">
    {#each themes as t}
      <button
        class="btn {app.theme === t.id ? 'btn-primary' : 'btn-ghost'}"
        role="radio"
        aria-checked={app.theme === t.id}
        onclick={() => { app.theme = t.id; savePrefs(); }}
      >
        <Icon name={t.icon} size={16} /> {t.label}
      </button>
    {/each}
  </div>
</section>

<section class="flex flex-col gap-4 rounded-xl border border-line bg-surface p-5 shadow-card">
  <h2 class="font-semibold">Admin password</h2>
  <form class="flex max-w-sm flex-col gap-4" onsubmit={changePassword}>
    <div class="flex flex-col gap-1.5">
      <label for="pw-current" class="text-sm font-medium">Current password</label>
      <input id="pw-current" type="password" class="field" bind:value={current} autocomplete="current-password" disabled={saving} />
    </div>
    <PasswordFields bind:password bind:confirm idPrefix="pw" disabled={saving} />
    {#if pwError}<p class="text-sm text-off" role="alert">{pwError}</p>{/if}
    <div><button class="btn btn-primary" disabled={!canSave}>{saving ? 'Saving…' : 'Change password'}</button></div>
  </form>
</section>

<section class="flex flex-col gap-4 rounded-xl border border-line bg-surface p-5 shadow-card">
  <h2 class="font-semibold">SSH connection</h2>
  {#if ssh}
    <div class="overflow-x-auto">
      <table class="w-full min-w-[420px] text-left text-sm">
        <thead class="text-xs text-ink-3">
          <tr><th class="pb-2 font-medium">Setting</th><th class="pb-2 font-medium">Variable</th><th class="pb-2 font-medium">Value</th><th class="pb-2 font-medium">Default</th></tr>
        </thead>
        <tbody>
          <tr class="border-t border-line"><td class="py-2 pr-4">Server address</td><td class="pr-4 font-mono text-[13px]">SSH_HOST</td><td class="pr-4 font-mono text-[13px]">{ssh.host}</td><td class="font-mono text-[13px] text-ink-3">172.29.88.1</td></tr>
          <tr class="border-t border-line"><td class="py-2 pr-4">Port</td><td class="pr-4 font-mono text-[13px]">SSH_PORT</td><td class="pr-4 font-mono text-[13px]">{ssh.port}</td><td class="font-mono text-[13px] text-ink-3">22</td></tr>
          <tr class="border-t border-line"><td class="py-2 pr-4">Account</td><td class="pr-4 font-mono text-[13px]">SSH_USER</td><td class="pr-4 font-mono text-[13px]">{ssh.user}</td><td class="font-mono text-[13px] text-ink-3">wgweb</td></tr>
        </tbody>
      </table>
    </div>
  {/if}
</section>

<section class="flex flex-col gap-4 rounded-xl border border-line bg-surface p-5 shadow-card">
  <h2 class="font-semibold">Server identity</h2>
  {#if hostKey?.pinned}
    <div class="flex flex-col gap-1 text-sm">
      <div class="font-mono text-[13px] break-all">{hostKey.pinned.fingerprint} <span class="font-sans text-xs text-ink-3">({hostKey.pinned.type})</span></div>
      <div class="text-xs text-ink-3">Confirmed {new Date(hostKey.pinned.at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</div>
    </div>
    {#if app.hostError?.code === 'hostkey_changed'}
      <div class="rounded-lg border border-off/40 bg-off-soft px-3 py-2.5 text-sm">
        The server now presents <span class="font-mono text-[13px] break-all">{hostKey.offered.fingerprint}</span>, which is different.
      </div>
    {/if}
    {#if forgetting}
      <div class="flex flex-col gap-3 rounded-lg border border-line bg-surface-2 p-3 text-sm">
        <p>Forget this fingerprint? You'll be asked to confirm the server again. Only do this if you rebuilt the server or regenerated its SSH keys.</p>
        <div class="flex gap-2">
          <button class="btn btn-danger" onclick={forget}>Forget and confirm again</button>
          <button class="btn btn-ghost" onclick={() => (forgetting = false)}>Cancel</button>
        </div>
      </div>
    {:else}
      <div><button class="btn btn-ghost" onclick={() => (forgetting = true)}>Confirm a new server identity…</button></div>
    {/if}
  {/if}
</section>

<section class="flex flex-col gap-4 rounded-xl border border-line bg-surface p-5 shadow-card">
  <h2 class="font-semibold">App key</h2>
  <InstallKey />
</section>

<section class="flex items-center justify-between gap-4 rounded-xl border border-line bg-surface p-5 shadow-card md:hidden">
  <span class="text-sm">Signed in as admin</span>
  <button class="btn btn-ghost" onclick={logout}><Icon name="logout" size={16} /> Sign out</button>
</section>

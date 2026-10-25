<script>
  import Icon from '../components/Icon.svelte';
  import InstallKey from '../components/InstallKey.svelte';
  import PasswordFields from '../components/PasswordFields.svelte';
  import { app, savePrefs, logout, notify, connect } from '../lib/store.svelte.js';
  import { api } from '../lib/api.js';
  import { MIN_PASSWORD, REPO_URL, DOCKER_HUB_URL } from '../lib/format.js';

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

<header class="flex items-center justify-between gap-4">
  <h1 class="text-2xl font-semibold tracking-tight">Settings</h1>
  <div class="flex items-center gap-1">
    <a
      class="rounded-md p-1 text-ink-2 transition-colors hover:text-ink"
      href={REPO_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="View source on GitHub"
      title="View source on GitHub"
    >
      <!-- GitHub's Invertocat mark (official SVG supplied by the owner), filled with the text colour so it suits both themes -->
      <svg width="26" height="26" viewBox="0 0 98 96" aria-hidden="true"><path fill="currentColor" d="M41.4395 69.3848C28.8066 67.8535 19.9062 58.7617 19.9062 46.9902C19.9062 42.2051 21.6289 37.0371 24.5 33.5918C23.2559 30.4336 23.4473 23.7344 24.8828 20.959C28.7109 20.4805 33.8789 22.4902 36.9414 25.2656C40.5781 24.1172 44.4062 23.543 49.0957 23.543C53.7852 23.543 57.6133 24.1172 61.0586 25.1699C64.0254 22.4902 69.2891 20.4805 73.1172 20.959C74.457 23.543 74.6484 30.2422 73.4043 33.4961C76.4668 37.1328 78.0937 42.0137 78.0937 46.9902C78.0937 58.7617 69.1934 67.6621 56.3691 69.2891C59.623 71.3945 61.8242 75.9883 61.8242 81.252L61.8242 91.2051C61.8242 94.0762 64.2168 95.7031 67.0879 94.5547C84.4102 87.9512 98 70.6289 98 49.1914C98 22.1074 75.9883 6.69539e-07 48.9043 4.309e-07C21.8203 1.92261e-07 -1.9479e-07 22.1074 -4.3343e-07 49.1914C-6.20631e-07 70.4375 13.4941 88.0469 31.6777 94.6504C34.2617 95.6074 36.75 93.8848 36.75 91.3008L36.75 83.6445C35.4102 84.2188 33.6875 84.6016 32.1562 84.6016C25.8398 84.6016 22.1074 81.1563 19.4277 74.7441C18.375 72.1602 17.2266 70.6289 15.0254 70.3418C13.877 70.2461 13.4941 69.7676 13.4941 69.1934C13.4941 68.0449 15.4082 67.1836 17.3223 67.1836C20.0977 67.1836 22.4902 68.9063 24.9785 72.4473C26.8926 75.2227 28.9023 76.4668 31.2949 76.4668C33.6875 76.4668 35.2187 75.6055 37.4199 73.4043C39.0469 71.7773 40.291 70.3418 41.4395 69.3848Z" /></svg>
    </a>
    <a
      class="rounded-md p-1 text-ink-2 transition-colors hover:text-ink"
      href={DOCKER_HUB_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="View image on Docker Hub"
      title="View image on Docker Hub"
    >
      <!-- Docker's mark (official SVG supplied by the owner), filled with the text colour like the GitHub mark -->
      <svg width="32" height="26" viewBox="0 0 340 268" aria-hidden="true"><path fill="currentColor" d="M334,110.1c-8.3-5.6-30.2-8-46.1-3.7-.9-15.8-9-29.2-24-40.8l-5.5-3.7-3.7,5.6c-7.2,11-10.3,25.7-9.2,39,.8,8.2,3.7,17.4,9.2,24.1-20.7,12-39.8,9.3-124.3,9.3H0c-.4,19.1,2.7,55.8,26,85.6,2.6,3.3,5.4,6.5,8.5,9.6,19,19,47.6,32.9,90.5,33,65.4,0,121.4-35.3,155.5-120.8,11.2.2,40.8,2,55.3-26,.4-.5,3.7-7.4,3.7-7.4l-5.5-3.7h0ZM85.2,92.7h-36.7v36.7h36.7v-36.7ZM132.6,92.7h-36.7v36.7h36.7v-36.7ZM179.9,92.7h-36.7v36.7h36.7v-36.7ZM227.3,92.7h-36.7v36.7h36.7v-36.7ZM37.8,92.7H1.1v36.7h36.7v-36.7ZM85.2,46.3h-36.7v36.7h36.7v-36.7ZM132.6,46.3h-36.7v36.7h36.7v-36.7ZM179.9,46.3h-36.7v36.7h36.7v-36.7ZM179.9,0h-36.7v36.7h36.7V0Z" /></svg>
    </a>
  </div>
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

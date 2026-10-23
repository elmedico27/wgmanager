<script>
  // New password + confirmation, checked as you type. Length is the only rule.
  import { passwordProblem, MIN_PASSWORD } from '../lib/format.js';

  let { password = $bindable(''), confirm = $bindable(''), idPrefix, disabled = false } = $props();
  let problem = $derived(passwordProblem(password, confirm));
  let lengthOk = $derived(password.length >= MIN_PASSWORD);
  let matchShown = $derived(confirm.length > 0);
</script>

<div class="flex flex-col gap-1.5">
  <label for="{idPrefix}-new" class="text-sm font-medium">New password</label>
  <input id="{idPrefix}-new" type="password" class="field" bind:value={password} autocomplete="new-password" {disabled} />
  <span class="text-xs {password && !lengthOk ? 'text-off' : 'text-ink-3'}">
    At least {MIN_PASSWORD} characters. A few unrelated words works well.
  </span>
</div>
<div class="flex flex-col gap-1.5">
  <label for="{idPrefix}-confirm" class="text-sm font-medium">Confirm password</label>
  <input id="{idPrefix}-confirm" type="password" class="field" bind:value={confirm} autocomplete="new-password" {disabled} />
  {#if matchShown}
    {#if password !== confirm}
      <span class="text-xs text-off">The two passwords do not match.</span>
    {:else if lengthOk}
      <span class="text-xs text-live">Passwords match.</span>
    {/if}
  {/if}
</div>

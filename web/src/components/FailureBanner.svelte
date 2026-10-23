<script>
  // Persistent warning for a mutation that failed or may be incomplete
  // (helper exit 5 `backend_failed`, or the app's 60 s SSH timeout). The backend
  // keeps them, so every browser sees them until someone acknowledges them.
  // A lost connection to the wgmanager server mid-change is kept locally.
  // Required by HELPER-SPEC 8.1: not a toast, cleared only by acknowledging it.
  import { slide } from 'svelte/transition';
  import Icon from './Icon.svelte';
  import { app, acknowledge } from '../lib/store.svelte.js';
  import { checkText, ACTION_WORDS } from '../lib/format.js';

  const BACKUP_DIR = '/var/backups/wgmanager'; // helper default (spec section 9)
  let iface = $derived(app.list?.interface.name ?? 'wg0');

  function nothingHappened(f) {
    const c = f.error.failed_checks ?? [];
    return f.action === 'add' && ['client_record', 'client_config_file', 'server_config_block', 'live_peer'].every((x) => c.includes(x));
  }

  function time(ms) {
    const d = new Date(ms);
    const t = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return d.toDateString() === new Date().toDateString() ? t : `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${t}`;
  }
</script>

{#each app.failures as f (f.id)}
  <section
    class="overflow-hidden rounded-xl border border-off/50 bg-surface shadow-card"
    transition:slide={{ duration: 200 }}
    role="alert"
  >
    <div class="flex gap-3 border-l-4 border-off p-4">
      <Icon name="alert" size={20} class="mt-0.5 shrink-0 text-off" />
      <div class="flex min-w-0 flex-1 flex-col gap-3 text-sm">
        <div>
          <div class="font-semibold">
            {#if f.error.code === 'timeout'}
              No answer from the host: {ACTION_WORDS[f.action].toLowerCase()} {f.client}
            {:else if f.error.code === 'network'}
              Lost contact with WG Manager: {ACTION_WORDS[f.action].toLowerCase()} {f.client}
            {:else}
              {ACTION_WORDS[f.action]} {f.client} may be incomplete
            {/if}
          </div>
          <div class="text-ink-2">
            {#if f.error.code === 'timeout'}
              The host did not answer within 60 seconds, so wgmanager can't tell whether the change happened. It
              was not retried. Check the client in the refreshed list.
            {:else if f.error.code === 'network'}
              The WG Manager server stopped answering during the change (restarted or unreachable), so it is not known
              whether the change happened. It was not retried. Check the client once the list loads again.
            {:else if f.error.partial === false}
              Nothing was changed, but the client is not in the expected state.
            {:else}
              The host may now be different from what you asked for. wgmanager does not undo changes automatically.
            {/if}
            <span class="text-ink-3">({time(f.at)})</span>
          </div>
        </div>

        {#if f.error.failed_checks?.length}
          <div>
            <div class="mb-1 font-medium">What did not check out</div>
            <ul class="flex flex-col gap-0.5 pl-5 text-ink-2">
              {#each f.error.failed_checks as c}<li class="list-disc">{checkText(f.action, c)}</li>{/each}
            </ul>
            {#if nothingHappened(f)}
              <p class="mt-1.5 text-ink-2">
                If nothing was created, PiVPN probably refused the add, for example because the VPN subnet has no free
                addresses left.
              </p>
            {/if}
          </div>
        {/if}

        {#if f.error.backup}
          <div class="rounded-lg bg-surface-2 px-3 py-2.5">
            <div class="mb-1 font-medium">Backup taken just before the change</div>
            <div class="font-mono text-[12.5px] break-all text-ink-2">
              {BACKUP_DIR}/{f.error.backup}.{iface}.conf<br />{BACKUP_DIR}/{f.error.backup}.clients.txt
            </div>
          </div>
        {/if}

        <div class="flex flex-wrap items-center gap-2">
          <a
            class="btn btn-ghost"
            href="https://github.com/elmedico27/wgmanager/blob/master/docs/RECOVERY.md"
            target="_blank"
            rel="noopener noreferrer">Recovery steps</a>
          <button class="btn btn-primary" onclick={() => acknowledge(f)}><Icon name="check" size={16} /> I've checked this</button>
        </div>
      </div>
    </div>
  </section>
{/each}

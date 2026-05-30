import { generateSessionKey, saveSessionKeyMaterial, forgetSessionKeyMaterial } from '@g2c/passkey-sdk';
import { delegateSessionKey } from './sessionKeyActions.js';

/** Approximate stroop blocks per duration. Soroban testnet has ~5s ledger
 *  closes → 17280 ledgers ≈ 24h. */
const DURATIONS: Record<string, number | null> = {
  '24h': 17280,
  '7d': 17280 * 7,
  '30d': 17280 * 30,
  'none': null,
};

export function mountDelegationForm(container: HTMLElement, account: string): void {
  container.hidden = false;
  container.innerHTML = `
    <h3>Delegate session key</h3>
    <p class="muted">Generate a fresh session key on this device and authorize it to sign for one target contract. The session key never leaves your browser.</p>
    <label style="display:block;margin-top:1rem">
      Target contract (C…)
      <input id="target" placeholder="C…" style="display:block;margin-top:0.25rem;width:100%"/>
    </label>
    <label style="display:block;margin-top:1rem">
      Duration
      <select id="duration" style="display:block;margin-top:0.25rem">
        <option value="24h">24 hours</option>
        <option value="7d">7 days</option>
        <option value="30d">30 days</option>
        <option value="none">No expiry</option>
      </select>
    </label>
    <label style="display:block;margin-top:1rem">
      Label (optional)
      <input id="label" style="display:block;margin-top:0.25rem"/>
    </label>
    <div class="actions" style="margin-top:1rem">
      <button id="cancel" type="button">Cancel</button>
      <button id="save" type="button">Sign &amp; delegate</button>
    </div>
  `;

  container.querySelector('#cancel')!.addEventListener('click', () => {
    container.hidden = true;
    container.innerHTML = '';
  });

  container.querySelector('#save')!.addEventListener('click', async () => {
    const target = (container.querySelector('#target') as HTMLInputElement).value.trim();
    const duration = (container.querySelector('#duration') as HTMLSelectElement).value;
    const label =
      (container.querySelector('#label') as HTMLInputElement).value.trim() || undefined;

    if (!target) { alert('Target contract required.'); return; }
    if (!target.startsWith('C') || target.length !== 56) {
      alert('Target must be a contract address starting with C (56 chars).');
      return;
    }

    const saveBtn = container.querySelector('#save') as HTMLButtonElement;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Generating key...';

    try {
      const k = await generateSessionKey();
      saveSessionKeyMaterial(account, target, {
        privateKey: k.privateKey,
        credentialId: k.credentialId,
        label,
      });

      saveBtn.textContent = 'Signing & submitting...';
      await delegateSessionKey({
        account,
        target,
        sessionPubkey: k.publicKey,
        validUntilOffset: DURATIONS[duration] ?? 17280,
        label,
      });

      container.innerHTML = '<p>Session key delegated. Refreshing…</p>';
      setTimeout(() => location.reload(), 800);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      forgetSessionKeyMaterial(account, target);
      alert('Failed to delegate: ' + msg);
      saveBtn.disabled = false;
      saveBtn.textContent = 'Sign & delegate';
    }
  });
}

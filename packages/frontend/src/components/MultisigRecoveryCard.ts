import type { MultisigRecoveryBlock } from '@nidohq/passkey-sdk';
import { multisigRecoveryModule } from '@nidohq/passkey-sdk';

export function renderRecoveryCard(block: MultisigRecoveryBlock): HTMLElement {
  const div = document.createElement('div');
  div.className = 'rule-card';
  div.innerHTML = `
    <strong>${escape(block.label ?? 'Recovery')}</strong>
    <span class="muted"> · ${block.threshold} of ${block.friends.length} must approve</span>
    <div class="chips">
      ${block.friends.map((f) =>
        `<span class="chip">${escape(f.nickname ?? f.address.slice(0, 6) + '…' + f.address.slice(-4))}</span>`,
      ).join(' ')}
    </div>
    <p class="muted small">${escape(multisigRecoveryModule.summarize(block))}</p>
    <div class="actions">
      <a class="recover-link" href="/security/recover/">Use to recover…</a>
      <button class="btn edit" disabled>Coming soon</button>
      <button class="btn remove" disabled>Coming soon</button>
    </div>
  `;
  return div;
}

function escape(s: string): string {
  return s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);
}

// @ts-check
import { fetchJSON } from '../lib/http.js';

const t = (/** @type {string} */ key) => chrome.i18n.getMessage(key) || key;

/**
 * GitHub Copilot premium requests. Forma verificada (2026-07):
 *  GET /settings/billing/usage?product=copilot → payload.customer.customerId
 *  GET /settings/billing/copilot_usage_card?customer_id={id}&period=3&query=&unit_type=1
 *      → {userPremiumRequestEntitlement, netQuantity}
 * El customer_id se descubre en el primer paso (no se hardcodea).
 */
export const copilot = {
  id: 'copilot',
  name: 'GitHub Copilot',
  origin: 'https://github.com/*',
  home: 'https://github.com/settings/billing',

  /** @returns {Promise<import('../lib/quota.js').Snapshot>} */
  async fetchSnapshot() {
    const billing = await fetchJSON('https://github.com/settings/billing/usage?product=copilot');
    const cid = customerIdFrom(billing);

    const card = await fetchJSON(
      `https://github.com/settings/billing/copilot_usage_card` +
        `?customer_id=${encodeURIComponent(cid)}&period=3&query=&unit_type=1`
    );
    return {
      platformId: 'copilot',
      ok: true,
      meters: parseCard(card),
      fetchedAt: Date.now(),
    };
  },
};

/**
 * El customer_id sale del primer paso, nunca hardcodeado.
 * @param {any} billing
 * @returns {string}
 */
export function customerIdFrom(billing) {
  const cid = billing?.payload?.customer?.customerId;
  if (cid === undefined || cid === null) {
    throw Object.assign(new Error('no customer id'), { name: 'ParseError' });
  }
  return String(cid);
}

/**
 * Medidor de solicitudes premium a partir de la tarjeta de uso.
 * @param {any} card
 * @returns {import('../lib/quota.js').Meter[]}
 */
export function parseCard(card) {
  const total = card?.userPremiumRequestEntitlement;
  const used = card?.netQuantity;
  if (!Number.isFinite(total)) {
    throw Object.assign(new Error('no entitlement'), { name: 'ParseError' });
  }

  const usedNum = Number.isFinite(used) ? Number(used) : 0;
  const totalNum = Number(total);
  return [
    {
      id: 'premium',
      label: t('meterPremiumRequests'),
      usedPct: totalNum > 0 ? Math.min(100, Math.max(0, Math.round((usedNum / totalNum) * 100))) : null,
      resetsAt: null,
      remaining: Math.round(totalNum - usedNum),
      total: Math.round(totalNum),
    },
  ];
}

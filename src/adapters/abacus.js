// @ts-check
import { fetchJSON } from '../lib/http.js';
import { pctFromCounts } from '../lib/quota.js';

const t = (/** @type {string} */ key) => chrome.i18n.getMessage(key) || key;

/**
 * Abacus.AI ChatLLM. Forma verificada (2026-07):
 *  GET  /api/_getOrganizationComputePoints → result.{computePointsLeft, totalComputePoints}
 *  POST /api/v1/_getBillingInfo            → result.{nextBillingDate, currentTier}
 * Los compute points se leen directo con la cookie de sesión; el billing da el reset.
 */
export const abacus = {
  id: 'abacus',
  name: 'Abacus ChatLLM',
  origin: 'https://apps.abacus.ai/*',
  home: 'https://apps.abacus.ai/chatllm',

  /** @returns {Promise<import('../lib/quota.js').Snapshot>} */
  async fetchSnapshot() {
    const cp = await fetchJSON('https://apps.abacus.ai/api/_getOrganizationComputePoints');

    // Reset y plan: mejor esfuerzo. Si este segundo endpoint falla, el medidor
    // igual sirve — solo pierde la hora de reinicio y el nombre del plan.
    /** @type {{resetsAt: number|null, plan: string|undefined}} */
    let billing = { resetsAt: null, plan: undefined };
    try {
      billing = parseBilling(
        await fetchJSON('https://apps.abacus.ai/api/v1/_getBillingInfo', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        }),
      );
    } catch { /* el reset/plan es opcional */ }

    return {
      platformId: 'abacus',
      ok: true,
      plan: billing.plan,
      meters: parseComputePoints(cp, billing.resetsAt ?? null),
      fetchedAt: Date.now(),
    };
  },
};

/**
 * Medidor de compute points.
 * @param {any} cp respuesta de _getOrganizationComputePoints
 * @param {number|null} resetsAt
 * @returns {import('../lib/quota.js').Meter[]}
 */
export function parseComputePoints(cp, resetsAt = null) {
  const r = cp?.result;
  if (!r || typeof r.computePointsLeft !== 'number' || typeof r.totalComputePoints !== 'number') {
    throw Object.assign(new Error('no compute points'), { name: 'ParseError' });
  }
  const left = r.computePointsLeft;
  const total = r.totalComputePoints;
  return [
    {
      id: 'compute',
      label: t('meterComputePoints'),
      usedPct: pctFromCounts(left, total),
      resetsAt,
      remaining: Math.round(left),
      total: Math.round(total),
    },
  ];
}

/**
 * Fecha de reinicio y nombre del plan, si el endpoint de billing los trae.
 * @param {any} bill
 * @returns {{resetsAt: number|null, plan: string|undefined}}
 */
export function parseBilling(bill) {
  let resetsAt = null;
  let plan;
  const next = bill?.result?.nextBillingDate;
  if (typeof next === 'string') {
    const ts = Date.parse(next);
    if (!Number.isNaN(ts)) resetsAt = ts;
  }
  const tier = bill?.result?.currentTier;
  if (typeof tier === 'string' && tier) plan = tier.charAt(0).toUpperCase() + tier.slice(1);
  return { resetsAt, plan };
}

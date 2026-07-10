// @ts-check
import { fetchJSON } from '../lib/http.js';

const t = (/** @type {string} */ key) => chrome.i18n.getMessage(key) || key;

/**
 * Forma verificada de /rest/rate-limit/all (2026-07): expone solo restantes
 * (remaining_pro, remaining_research, remaining_labs, remaining_agentic_research),
 * sin totales ni hora de reset.
 */
export const perplexity = {
  id: 'perplexity',
  name: 'Perplexity',
  origin: 'https://www.perplexity.ai/*',
  home: 'https://www.perplexity.ai',

  /** @returns {Promise<import('../lib/quota.js').Snapshot>} */
  async fetchSnapshot() {
    const data = await fetchJSON('https://www.perplexity.ai/rest/rate-limit/all');

    /** @type {import('../lib/quota.js').Meter[]} */
    const meters = [];
    for (const [key, labelKey] of [
      ['remaining_pro', 'meterProSearches'],
      ['remaining_research', 'meterResearch'],
      ['remaining_agentic_research', 'meterAgentic'],
      ['remaining_labs', 'meterLabs'],
    ]) {
      const remaining = data?.[key];
      if (!Number.isFinite(remaining)) continue;
      meters.push({
        id: String(key),
        label: t(String(labelKey)),
        usedPct: null,
        resetsAt: null,
        remaining,
        total: null,
      });
    }
    if (!meters.length) throw Object.assign(new Error('no meters'), { name: 'ParseError' });

    return { platformId: 'perplexity', ok: true, meters, fetchedAt: Date.now() };
  },
};

// @ts-check
import { fetchJSON } from '../lib/http.js';
import { pctFromCounts } from '../lib/quota.js';

const t = (/** @type {string} */ key, /** @type {string|undefined} */ arg = undefined) =>
  chrome.i18n.getMessage(key, arg ? [arg] : undefined) || key;

/**
 * Forma verificada de POST /rest/rate-limits (2026-07):
 * {windowSizeSeconds, remainingQueries, totalQueries}. No expone hora de reset,
 * solo el tamaño de la ventana rodante.
 */
export const grok = {
  id: 'grok',
  name: 'Grok',
  origin: 'https://grok.com/*',
  home: 'https://grok.com',

  /** @returns {Promise<import('../lib/quota.js').Snapshot>} */
  async fetchSnapshot() {
    const post = (/** @type {object} */ body) =>
      fetchJSON('https://grok.com/rest/rate-limits', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

    let data;
    try {
      data = await post({ requestKind: 'DEFAULT', modelName: 'grok-4' });
    } catch (e) {
      if (e instanceof Error && e.name === 'AuthError') throw e;
      data = await post({ requestKind: 'DEFAULT' });
    }

    const remaining = data?.remainingQueries;
    const total = data?.totalQueries;
    if (!Number.isFinite(remaining) || !Number.isFinite(total)) {
      throw Object.assign(new Error('no meters'), { name: 'ParseError' });
    }

    const hours = Number.isFinite(data?.windowSizeSeconds)
      ? Math.round(data.windowSizeSeconds / 3600)
      : null;

    return {
      platformId: 'grok',
      ok: true,
      meters: [
        {
          id: 'default',
          label: hours ? t('meterWindowHours', String(hours)) : t('meterSession'),
          usedPct: pctFromCounts(remaining, total),
          resetsAt: null,
          remaining,
          total,
        },
      ],
      fetchedAt: Date.now(),
    };
  },
};

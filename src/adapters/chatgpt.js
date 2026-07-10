// @ts-check
import { fetchJSON } from '../lib/http.js';
import { AuthError } from '../lib/http.js';

const t = (/** @type {string} */ key, /** @type {string|undefined} */ arg = undefined) =>
  chrome.i18n.getMessage(key, arg ? [arg] : undefined) || key;

/**
 * Forma verificada de /backend-api/wham/usage (2026-07): requiere bearer token
 * obtenido de /api/auth/session (el mismo flujo que usa el front de chatgpt.com).
 * rate_limit.primary_window / secondary_window: {used_percent, limit_window_seconds, reset_at (epoch s)}.
 */
export const chatgpt = {
  id: 'chatgpt',
  name: 'ChatGPT',
  origin: 'https://chatgpt.com/*',
  home: 'https://chatgpt.com',

  /** @returns {Promise<import('../lib/quota.js').Snapshot>} */
  async fetchSnapshot() {
    const session = await fetchJSON('https://chatgpt.com/api/auth/session');
    const token = session?.accessToken;
    if (!token) throw new AuthError('no session');

    const usage = await fetchJSON('https://chatgpt.com/backend-api/wham/usage', {
      headers: { authorization: `Bearer ${token}` },
    });

    /** @type {import('../lib/quota.js').Meter[]} */
    const meters = [];
    for (const [id, win] of [
      ['primary', usage?.rate_limit?.primary_window],
      ['secondary', usage?.rate_limit?.secondary_window],
    ]) {
      if (typeof win?.used_percent !== 'number') continue;
      const seconds = win.limit_window_seconds;
      const label =
        Number.isFinite(seconds) && seconds >= 6 * 24 * 3600
          ? t('meterWeek')
          : t('meterWindowHours', String(Math.round((seconds ?? 18000) / 3600)));
      meters.push({
        id: String(id),
        label,
        usedPct: Math.round(win.used_percent),
        resetsAt: Number.isFinite(win.reset_at) ? win.reset_at * 1000 : null,
      });
    }
    if (!meters.length) throw Object.assign(new Error('no meters'), { name: 'ParseError' });

    return {
      platformId: 'chatgpt',
      ok: true,
      plan: prettyPlan(usage?.plan_type),
      account: typeof usage?.email === 'string' ? usage.email : undefined,
      meters,
      fetchedAt: Date.now(),
    };
  },
};

/** @param {string=} plan */
function prettyPlan(plan) {
  if (!plan || typeof plan !== 'string') return undefined;
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}

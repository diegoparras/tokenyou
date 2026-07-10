// @ts-check
import { fetchJSON } from '../lib/http.js';

const t = (/** @type {string} */ key, /** @type {string|undefined} */ arg = undefined) =>
  chrome.i18n.getMessage(key, arg ? [arg] : undefined) || key;

/**
 * Forma verificada de /api/organizations/{org}/usage (2026-07):
 * preferimos el array normalizado `limits[]` ({kind, percent, resets_at, scope})
 * y caemos a los objetos legacy five_hour/seven_day si desaparece.
 */
export const claude = {
  id: 'claude',
  name: 'Claude',
  origin: 'https://claude.ai/*',
  home: 'https://claude.ai',

  /** @returns {Promise<import('../lib/quota.js').Snapshot>} */
  async fetchSnapshot() {
    const orgs = await fetchJSON('https://claude.ai/api/organizations');
    const org = (Array.isArray(orgs) ? orgs : []).find(
      (o) => Array.isArray(o?.capabilities) && o.capabilities.includes('chat')
    ) ?? (Array.isArray(orgs) ? orgs[0] : null);
    if (!org?.uuid) throw Object.assign(new Error('no org'), { name: 'ParseError' });

    const usage = await fetchJSON(`https://claude.ai/api/organizations/${org.uuid}/usage`);

    /** @type {import('../lib/quota.js').Meter[]} */
    const meters = [];
    if (Array.isArray(usage?.limits) && usage.limits.length) {
      for (const lim of usage.limits) {
        if (typeof lim?.percent !== 'number') continue;
        meters.push({
          id: String(lim.kind ?? lim.group ?? meters.length),
          label: labelForKind(lim),
          usedPct: Math.round(lim.percent),
          resetsAt: lim.resets_at ? Date.parse(lim.resets_at) : null,
        });
      }
    } else {
      for (const [key, labelKey] of [
        ['five_hour', 'meterSession'],
        ['seven_day', 'meterWeekAll'],
        ['seven_day_opus', 'meterWeekModel'],
      ]) {
        const w = usage?.[key];
        if (typeof w?.utilization !== 'number') continue;
        meters.push({
          id: key,
          label: labelKey === 'meterWeekModel' ? t(labelKey, 'Opus') : t(labelKey),
          usedPct: Math.round(w.utilization),
          resetsAt: w.resets_at ? Date.parse(w.resets_at) : null,
        });
      }
    }
    if (!meters.length) throw Object.assign(new Error('no meters'), { name: 'ParseError' });

    return {
      platformId: 'claude',
      ok: true,
      plan: planFromTier(org.rate_limit_tier),
      meters,
      fetchedAt: Date.now(),
    };
  },
};

/** @param {{kind?: string, scope?: {model?: {display_name?: string}}}} lim */
function labelForKind(lim) {
  if (lim.kind === 'session') return t('meterSession');
  if (lim.kind === 'weekly_all') return t('meterWeekAll');
  const model = lim.scope?.model?.display_name;
  if (model) return t('meterWeekModel', model);
  return t('meterWeek');
}

/** "default_claude_max_20x" → "Max 20x" @param {string=} tier */
function planFromTier(tier) {
  if (!tier) return undefined;
  const short = tier.replace(/^default_claude_/, '').replace(/_/g, ' ');
  return short.charAt(0).toUpperCase() + short.slice(1);
}

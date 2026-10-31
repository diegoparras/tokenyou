// @ts-check
import { fetchJSON } from '../lib/http.js';

const t = (/** @type {string} */ key, /** @type {string|undefined} */ arg = undefined) =>
  chrome.i18n.getMessage(key, arg ? [arg] : undefined) || key;

/**
 * Forma verificada de /api/organizations/{org}/usage (2026-10):
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

    return {
      platformId: 'claude',
      ok: true,
      plan: planFromTier(org.rate_limit_tier),
      meters: parseUsage(usage),
      fetchedAt: Date.now(),
    };
  },
};

/**
 * Convierte la respuesta de /usage en medidores. Pura a propósito: se testea
 * contra payloads reales, que es donde esta plataforma cambia sin avisar.
 *
 * Lanza `UnsupportedPlanError` cuando la respuesta tiene la forma esperada pero
 * no trae ningún límite — el plan gratuito responde 200 con todo en null y
 * `limits: []`. Eso no es un fallo nuestro y no debe reportarse como tal.
 *
 * @param {any} usage
 * @returns {import('../lib/quota.js').Meter[]}
 */
export function parseUsage(usage) {
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

  const extra = usage?.extra_usage;
  if (extra?.is_enabled) {
    // `utilization` puede venir en null aunque haya créditos: en ese caso el
    // porcentaje sale de lo gastado sobre el tope del mes.
    const pct = typeof extra.utilization === 'number' ? extra.utilization : pctFromCredits(extra);
    if (pct !== null) {
      meters.push({
        id: 'extra_usage',
        label: t('meterExtraUsage'),
        usedPct: Math.round(pct),
        resetsAt: null,
        detail: moneyDetail(extra),
      });
    }
  }

  if (!meters.length) {
    // Distinguimos "tu plan no publica la cuota" de "no entiendo la respuesta".
    // Si vienen las claves conocidas, la API está bien: lo que no hay es dato.
    const shaped = !!usage && typeof usage === 'object'
      && ('limits' in usage || 'five_hour' in usage);
    throw shaped
      ? Object.assign(new Error('plan does not publish usage'), { name: 'UnsupportedPlanError' })
      : Object.assign(new Error('no meters'), { name: 'ParseError' });
  }
  return meters;
}

/** @param {{kind?: string, scope?: {model?: {display_name?: string}}}} lim */
function labelForKind(lim) {
  if (lim.kind === 'session') return t('meterSession');
  if (lim.kind === 'weekly_all') return t('meterWeekAll');
  const model = lim.scope?.model?.display_name;
  if (model) return t('meterWeekModel', model);
  return t('meterWeek');
}

/**
 * Porcentaje del uso extra a partir de los créditos, para cuando la API no
 * manda `utilization`.
 * @param {{used_credits?: number, monthly_limit?: number}} extra
 * @returns {number|null}
 */
function pctFromCredits(extra) {
  const used = Number(extra.used_credits);
  const limit = Number(extra.monthly_limit);
  if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) return null;
  return Math.min(100, (used / limit) * 100);
}

/**
 * "US$ 21,84 / US$ 100,00" a partir de créditos enteros + decimal_places.
 * @param {{used_credits?: number, monthly_limit?: number, currency?: string, decimal_places?: number}} extra
 * @returns {string|undefined}
 */
function moneyDetail(extra) {
  const dp = Number.isFinite(extra.decimal_places) ? Number(extra.decimal_places) : 2;
  const currency = extra.currency || 'USD';
  if (!Number.isFinite(extra.used_credits) || !Number.isFinite(extra.monthly_limit)) return undefined;
  const fmt = new Intl.NumberFormat(undefined, { style: 'currency', currency });
  const used = Number(extra.used_credits) / 10 ** dp;
  const limit = Number(extra.monthly_limit) / 10 ** dp;
  const left = Math.max(0, limit - used);
  return `${fmt.format(used)} · ${t('moneyLeft', fmt.format(left))}`;
}

/**
 * Nombres comerciales que no se deducen del identificador. Anthropic renombró
 * los planes el 2026-10-30 —Max 20x pasó a Ultra y Max 5x a Max— sin tocar los
 * tiers internos, así que hay que traducirlos a mano.
 * @type {Record<string, string>}
 */
const PLAN_NAMES = {
  default_claude_max_20x: 'Ultra',
  default_claude_max_5x: 'Max',
};

/** "default_claude_max_20x" → "Ultra" @param {string=} tier */
export function planFromTier(tier) {
  if (!tier) return undefined;
  if (PLAN_NAMES[tier]) return PLAN_NAMES[tier];
  const short = tier.replace(/^default_claude_/, '').replace(/_/g, ' ');
  return short.charAt(0).toUpperCase() + short.slice(1);
}

// @ts-check
import { grpcWebUnary, decodeFields, numberAt, bytesAt, timestampMs } from '../lib/grpcweb.js';

const t = (/** @type {string} */ key, /** @type {string|undefined} */ arg = undefined) =>
  chrome.i18n.getMessage(key, arg ? [arg] : undefined) || key;

const CREDITS_URL = 'https://grok.com/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig';

/**
 * Grok dejó de gobernarse por el viejo contador de consultas por ventana
 * (POST /rest/rate-limits, que además responde 404 si se le pasa modelName).
 * Desde junio de 2026 la cuenta se mide contra un pool semanal compartido —el
 * "Límite semanal Premium"—, que la propia web lee de GetGrokCreditsConfig por
 * gRPC-Web. xAI lo anunció como un pool único "entre Chat, Imagine, Build y
 * otros productos", en reemplazo de los límites diarios por producto.
 *
 * Esquema deducido de dos capturas reales contrastadas con la pantalla de Uso
 * (ver test/fixtures/grok-credits-*.txt):
 *   campo 1 → configuración
 *     campo 1 (float) porcentaje total usado
 *     campo 4 / 5     inicio y fin de la ventana (google.protobuf.Timestamp)
 *     campo 7 (rep.)  desglose por categoría {1: id, 2: porcentaje}
 *
 * Los ids del desglose son el enum `Product` del propio bundle de Grok:
 *   1 API · 2 GROK_BUILD · 3 GROK_PLUGINS · 4 GROK_CHAT · 5 GROK_IMAGINE
 *   6 GROK_VOICE · 7 GROK_APP_BUILDER · 8 GROK_TASKS · 9 GROK_BOT
 *   10 CURSOR · 11 BUGBOT
 * Coinciden con lo observado: 4 y 7 son el "Chat 1%" y el "Creador de apps 5%"
 * que mostraba la pantalla de Uso.
 *
 * Aun así exponemos solo el total. Es el número que gobierna la cuenta, y el
 * único que xAI publica: no hay tamaño de pool documentado para ningún plan.
 */
export const grok = {
  id: 'grok',
  name: 'Grok',
  origin: 'https://grok.com/*',
  home: 'https://grok.com',

  /** @returns {Promise<import('../lib/quota.js').Snapshot>} */
  async fetchSnapshot() {
    const fields = await grpcWebUnary(CREDITS_URL);
    return {
      platformId: 'grok',
      ok: true,
      meters: parseCredits(fields),
      fetchedAt: Date.now(),
    };
  },
};

/**
 * Convierte la configuración de créditos en medidores. Pura: se testea contra
 * los payloads reales, que es donde esto puede cambiar sin aviso.
 * @param {import('../lib/grpcweb.js').Field[]} fields campos del mensaje
 * @returns {import('../lib/quota.js').Meter[]}
 */
export function parseCredits(fields) {
  const configBytes = bytesAt(fields, 1);
  if (!configBytes) throw Object.assign(new Error('sin configuración'), { name: 'ParseError' });

  const config = decodeFields(configBytes);
  const usedPct = numberAt(config, 1);
  if (usedPct === null) throw Object.assign(new Error('sin porcentaje'), { name: 'ParseError' });

  const endsAt = bytesAt(config, 5);
  return [
    {
      id: 'weekly',
      label: t('meterWeek'),
      usedPct: Math.round(usedPct),
      resetsAt: endsAt ? timestampMs(endsAt) : null,
    },
  ];
}

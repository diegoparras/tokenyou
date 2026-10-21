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
 * Exponemos solo el total, a propósito. Las categorías observadas son 4 (Chat)
 * y 7 (Creador de apps), pero el pool cubre más productos de los que pudimos
 * ver: nombrar dos y callar el resto daría un desglose que no suma el total.
 * El porcentaje global es además el único número que xAI publica — no hay
 * tamaño de pool documentado para ningún plan.
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

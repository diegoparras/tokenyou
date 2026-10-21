// @ts-check
import { grpcWebUnary, decodeFields, numberAt, bytesAt, timestampMs } from '../lib/grpcweb.js';

const t = (/** @type {string} */ key, /** @type {string|undefined} */ arg = undefined) =>
  chrome.i18n.getMessage(key, arg ? [arg] : undefined) || key;

const CREDITS_URL = 'https://grok.com/grok_api_v2.GrokBuildBilling/GetGrokCreditsConfig';

/**
 * Enum `Product` de Grok. Nombres cortos: la línea del desglose es angosta.
 * @type {Record<number, string>}
 */
const PRODUCTS = {
  1: 'API', 2: 'Build', 3: 'Plugins', 4: 'Chat', 5: 'Imagine',
  6: 'Voice', 7: 'Apps', 8: 'Tasks', 9: 'Bot', 10: 'Cursor', 11: 'Bugbot',
};
/**
 * Cuántos productos se nombran antes de agrupar el resto en "otros".
 * Dos: la línea del reinicio también carga el aviso de proyección y el popup
 * tiene que seguir entrando en un renglón.
 */
const MAX_PARTS = 2;

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
      detail: breakdown(config),
    },
  ];
}

/**
 * Desglose por producto, p. ej. "Apps 5% · Chat 1%".
 *
 * Nombra los de mayor consumo y agrupa el resto —incluidos los ids que no
 * conocemos— bajo "otros", calculado por suma. Así el desglose cierra contra
 * el total aunque xAI agregue un producto nuevo. Con un solo producto no
 * devuelve nada: repetiría el total sin aportar.
 *
 * @param {import('../lib/grpcweb.js').Field[]} config
 * @returns {string|undefined}
 */
function breakdown(config) {
  const parts = config
    .filter((f) => f.field === 7 && f.value instanceof Uint8Array)
    .map((f) => decodeFields(/** @type {Uint8Array} */ (f.value)))
    .map((sub) => ({ id: numberAt(sub, 1), pct: numberAt(sub, 2) ?? 0 }))
    .filter((p) => p.pct > 0)
    .sort((a, b) => b.pct - a.pct);
  if (parts.length < 2) return undefined;

  const named = parts.filter((p) => p.id !== null && PRODUCTS[p.id]);
  const shown = named.slice(0, MAX_PARTS);
  const restPct = parts
    .filter((p) => !shown.includes(p))
    .reduce((sum, p) => sum + p.pct, 0);

  const bits = shown.map((p) => `${PRODUCTS[/** @type {number} */ (p.id)]} ${Math.round(p.pct)}%`);
  if (Math.round(restPct) > 0) bits.push(`${t('otherProducts')} ${Math.round(restPct)}%`);
  return bits.length ? bits.join(' · ') : undefined;
}

// @ts-check
import { fetchJSON, AuthError } from '../lib/http.js';

const t = (/** @type {string} */ key, /** @type {string|undefined} */ arg = undefined) =>
  chrome.i18n.getMessage(key, arg ? [arg] : undefined) || key;

/**
 * Gemini expone su cuota real vía el RPC interno `jSf9Qc` de Boq (batchexecute).
 * A diferencia de Claude/ChatGPT no hay un GET simple: el POST necesita el token
 * anti-CSRF `SNlM0e` y el build label `cfb2h`, ambos embebidos en el HTML de la
 * app. El flujo (verificado 2026-07-10) es: GET del HTML → extraer los dos tokens
 * → POST al RPC. No corre ningún script en la página ni se leen conversaciones:
 * es el mismo patrón "leer solo el endpoint de cuota" que el resto de plataformas.
 *
 * Respuesta: payload[1] = [ventana, ...], cada una
 *   [valor, fracciónUso(0..1), tipoVentana, [[resetSeg, resetNanos]]]
 * tipoVentana 1 = actual (~5 h), 2 = semanal.
 */
export const gemini = {
  id: 'gemini',
  name: 'Gemini',
  origin: 'https://gemini.google.com/*',
  home: 'https://gemini.google.com',

  /** @returns {Promise<import('../lib/quota.js').Snapshot>} */
  async fetchSnapshot() {
    const html = await fetch('https://gemini.google.com/app', { credentials: 'include' }).then((r) => {
      if (r.status === 401 || r.status === 403) throw new AuthError(`HTTP ${r.status}`);
      return r.text();
    });
    const at = html.match(/"SNlM0e":"([^"]+)"/)?.[1];
    const bl = html.match(/"cfb2h":"([^"]+)"/)?.[1];
    // Sin token de sesión la app sirve el HTML de login: lo tratamos como "sin sesión".
    if (!at || !bl) throw new AuthError('no session tokens');

    const body = new URLSearchParams({
      'f.req': JSON.stringify([[['jSf9Qc', '[]', null, 'generic']]]),
      at,
    });
    const url =
      `https://gemini.google.com/_/BardChatUi/data/batchexecute` +
      `?rpcids=jSf9Qc&source-path=%2Fusage&bl=${encodeURIComponent(bl)}&hl=en&rt=c`;
    const raw = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body,
    }).then((r) => {
      if (r.status === 401 || r.status === 403) throw new AuthError(`HTTP ${r.status}`);
      if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { name: 'HttpError' });
      return r.text();
    });

    const windows = parseUsage(raw);
    if (!windows.length) throw Object.assign(new Error('no meters'), { name: 'ParseError' });

    return { platformId: 'gemini', ok: true, meters: windows, fetchedAt: Date.now() };
  },
};

/**
 * Extrae los medidores de la respuesta batchexecute.
 * @param {string} raw
 * @returns {import('../lib/quota.js').Meter[]}
 */
function parseUsage(raw) {
  const line = raw.split('\n').find((l) => l.includes('"wrb.fr"') && l.includes('jSf9Qc'));
  if (!line) return [];
  let payload;
  try {
    const envelope = /** @type {any[]} */ (JSON.parse(line));
    const inner = envelope.find((row) => row[0] === 'wrb.fr')?.[2];
    payload = inner ? JSON.parse(inner) : null;
  } catch {
    return [];
  }
  const list = Array.isArray(payload?.[1]) ? payload[1] : [];

  /** @type {import('../lib/quota.js').Meter[]} */
  const meters = [];
  for (const w of list) {
    const fraction = w?.[1];
    const type = w?.[2];
    const resetSec = w?.[3]?.[0]?.[0];
    if (typeof fraction !== 'number') continue;
    meters.push({
      id: type === 1 ? 'session' : type === 2 ? 'weekly' : `window-${type}`,
      label: type === 1 ? t('meterSession') : type === 2 ? t('meterWeek') : t('meterWindowHours', '?'),
      usedPct: Math.min(100, Math.max(0, Math.round(fraction * 100))),
      resetsAt: Number.isFinite(resetSec) ? resetSec * 1000 : null,
    });
  }
  return meters;
}

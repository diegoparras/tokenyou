// @ts-check
import { fetchJSON } from '../lib/http.js';
import { pctFromCounts } from '../lib/quota.js';

export const SERVICES_KEY = 'custom.services';

/**
 * Servicio definido por el usuario (usuarios avanzados, vía la página de opciones).
 *
 * @typedef {Object} MeterDef
 * @property {string} id
 * @property {string} label
 * @property {string} [pctPath]       Ruta (a.b.c) a un porcentaje usado 0-100.
 * @property {string} [usedPath]      Ruta a unidades consumidas.
 * @property {string} [remainingPath] Ruta a unidades restantes.
 * @property {string} [totalPath]     Ruta al total de unidades.
 * @property {string} [resetPath]     Ruta al reset (epoch s/ms o fecha ISO).
 *
 * @typedef {Object} ServiceDef
 * @property {string} id
 * @property {string} name
 * @property {string} origin  Patrón de host, p. ej. "https://cursor.com/*"
 * @property {string} url     Endpoint de uso a leer.
 * @property {'GET'|'POST'} [method]
 * @property {object} [body]  Cuerpo JSON para POST.
 * @property {string} [planPath]
 * @property {MeterDef[]} meters
 */

/** @returns {Promise<ServiceDef[]>} */
export async function getCustomServices() {
  const stored = await chrome.storage.local.get(SERVICES_KEY);
  return Array.isArray(stored[SERVICES_KEY]) ? stored[SERVICES_KEY] : [];
}

/** @param {ServiceDef[]} services */
export async function setCustomServices(services) {
  await chrome.storage.local.set({ [SERVICES_KEY]: services });
}

/**
 * Errores de validación legibles; array vacío si la definición es válida.
 * @param {any} def
 * @returns {string[]}
 */
export function validateService(def) {
  const errors = [];
  if (!def || typeof def !== 'object') return ['service must be an object'];
  if (!def.id || !/^[a-z0-9-]+$/.test(def.id)) errors.push(`id: lowercase letters/digits/hyphens required`);
  if (!def.name || typeof def.name !== 'string') errors.push('name: required');
  if (typeof def.origin !== 'string' || !/^https:\/\/[^/]+\/\*$/.test(def.origin)) {
    errors.push('origin: must look like "https://host/*" (https only)');
  }
  if (typeof def.url !== 'string' || !def.url.startsWith('https://')) {
    errors.push('url: must be an https:// URL');
  } else if (typeof def.origin === 'string') {
    const host = def.origin.replace(/^https:\/\//, '').replace(/\/\*$/, '');
    try {
      if (new URL(def.url).host !== host) errors.push('url: must be on the same host as origin');
    } catch {
      errors.push('url: not a valid URL');
    }
  }
  if (def.method && !['GET', 'POST'].includes(def.method)) errors.push('method: GET or POST');
  if (!Array.isArray(def.meters) || !def.meters.length) errors.push('meters: at least one required');
  for (const m of def.meters ?? []) {
    if (!m?.id || !m?.label) errors.push('meter: id and label required');
    if (!m?.pctPath && !m?.usedPath && !m?.remainingPath) {
      errors.push(`meter ${m?.id}: needs pctPath, usedPath or remainingPath`);
    }
  }
  return errors;
}

/** @param {any} obj @param {string} path */
function getPath(obj, path) {
  return path.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
}

/** @param {any} value epoch en s/ms o string ISO @returns {number|null} */
function parseReset(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === 'string') {
    const ts = Date.parse(value);
    return Number.isNaN(ts) ? null : ts;
  }
  return null;
}

/**
 * Construye los medidores a partir de la respuesta del endpoint.
 * Compartido entre el adaptador y el botón "Probar" de opciones.
 * @param {ServiceDef} def
 * @param {any} data
 * @returns {import('../lib/quota.js').Meter[]}
 */
export function buildMeters(def, data) {
  /** @type {import('../lib/quota.js').Meter[]} */
  const meters = [];
  for (const m of def.meters) {
    const pct = m.pctPath ? Number(getPath(data, m.pctPath)) : NaN;
    const used = m.usedPath ? Number(getPath(data, m.usedPath)) : NaN;
    const remaining = m.remainingPath ? Number(getPath(data, m.remainingPath)) : NaN;
    const total = m.totalPath ? Number(getPath(data, m.totalPath)) : NaN;
    const resetsAt = m.resetPath ? parseReset(getPath(data, m.resetPath)) : null;

    /** @type {import('../lib/quota.js').Meter} */
    const meter = { id: m.id, label: m.label, usedPct: null, resetsAt };
    if (Number.isFinite(pct)) {
      meter.usedPct = Math.min(100, Math.max(0, Math.round(pct)));
    } else if (Number.isFinite(used) && Number.isFinite(total) && total > 0) {
      meter.usedPct = Math.min(100, Math.max(0, Math.round((used / total) * 100)));
      meter.remaining = total - used;
      meter.total = total;
    } else if (Number.isFinite(remaining) && Number.isFinite(total)) {
      meter.usedPct = pctFromCounts(remaining, total);
      meter.remaining = remaining;
      meter.total = total;
    } else if (Number.isFinite(used)) {
      meter.used = used;
    } else if (Number.isFinite(remaining)) {
      meter.remaining = remaining;
    } else {
      continue;
    }
    meters.push(meter);
  }
  return meters;
}

/**
 * Convierte una definición en un adaptador con la misma interfaz que los nativos.
 * @param {ServiceDef} def
 */
export function customToAdapter(def) {
  return {
    id: `custom-${def.id}`,
    name: def.name,
    origin: def.origin,
    home: def.origin.replace(/\/\*$/, ''),
    custom: true,

    /** @returns {Promise<import('../lib/quota.js').Snapshot>} */
    async fetchSnapshot() {
      const init = /** @type {RequestInit} */ (
        def.method === 'POST'
          ? {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(def.body ?? {}),
            }
          : {}
      );
      const data = await fetchJSON(def.url, init);
      const meters = buildMeters(def, data);
      if (!meters.length) throw Object.assign(new Error('no meters'), { name: 'ParseError' });
      const plan = def.planPath ? getPath(data, def.planPath) : undefined;
      return {
        platformId: `custom-${def.id}`,
        ok: true,
        plan: typeof plan === 'string' ? plan : undefined,
        meters,
        fetchedAt: Date.now(),
      };
    },
  };
}

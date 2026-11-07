// @ts-check
// Exportación del historial. Si el argumento del producto es que los datos son
// tuyos y viven en tu navegador, tenés que poder llevártelos.
//
// Módulo puro: entra el volcado de storage, sale texto. Por eso se puede testear
// y por eso la descarga no necesita el permiso `downloads` — la página de
// opciones arma un Blob y lo baja con un <a download>.
//
// Se exporta el historial de uso y los snapshots, no la configuración: un
// servicio personalizado puede apuntar a un dashboard interno, y esa URL no es
// un dato de uso.

const PTS_PREFIX = 'hist.pts.';
const ACT_PREFIX = 'hist.act.';
const SNAP_PREFIX = 'snap.';

export const CSV_HEADER = 'platform,meter,timestamp,iso,used_pct';

/**
 * @typedef {Object} MeterHistory
 * @property {string} id        `${platformId}/${meterId}`
 * @property {string} platform
 * @property {string} meter
 * @property {{t:number,v:number}[]} points
 * @property {Record<string, number>} activity
 */

/**
 * Agrupa las claves `hist.*` de storage por medidor.
 * @param {Record<string, any>} store volcado de chrome.storage.local
 * @returns {Record<string, MeterHistory>}
 */
export function collectHistory(store) {
  /** @type {Record<string, MeterHistory>} */
  const out = {};

  /** El id puede contener barras (el medidor de un servicio propio), así que
   * solo se parte en la primera. */
  const entry = (/** @type {string} */ id) => {
    if (!out[id]) {
      const slash = id.indexOf('/');
      out[id] = {
        id,
        platform: slash < 0 ? id : id.slice(0, slash),
        meter: slash < 0 ? '' : id.slice(slash + 1),
        points: [],
        activity: {},
      };
    }
    return out[id];
  };

  for (const [key, value] of Object.entries(store ?? {})) {
    if (key.startsWith(PTS_PREFIX) && Array.isArray(value)) {
      entry(key.slice(PTS_PREFIX.length)).points = value
        .filter((p) => p && Number.isFinite(p.t) && Number.isFinite(p.v))
        .sort((a, b) => a.t - b.t);
    } else if (key.startsWith(ACT_PREFIX) && value && typeof value === 'object') {
      entry(key.slice(ACT_PREFIX.length)).activity = value;
    }
  }
  return out;
}

/**
 * Historial + snapshots como JSON legible.
 * @param {Record<string, any>} store
 * @param {{version: string, now?: number}} meta
 * @returns {string}
 */
export function toJson(store, meta) {
  const now = meta.now ?? Date.now();
  const history = collectHistory(store);
  /** @type {Record<string, any>} */
  const snapshots = {};
  for (const [key, value] of Object.entries(store ?? {})) {
    if (key.startsWith(SNAP_PREFIX)) snapshots[key.slice(SNAP_PREFIX.length)] = value;
  }

  return JSON.stringify(
    {
      app: 'TokenYou',
      version: meta.version,
      exportedAt: new Date(now).toISOString(),
      note: 'Usage history only. No credentials, no configuration, no telemetry.',
      meters: Object.values(history).sort((a, b) => a.id.localeCompare(b.id)),
      snapshots,
    },
    null,
    2,
  );
}

/**
 * La serie completa como CSV, una fila por punto. Es el formato que entra
 * directo en una planilla.
 * @param {Record<string, any>} store
 * @returns {string}
 */
export function toCsv(store) {
  const history = collectHistory(store);
  const rows = [CSV_HEADER];
  for (const m of Object.values(history).sort((a, b) => a.id.localeCompare(b.id))) {
    for (const p of m.points) {
      rows.push([
        csvCell(m.platform),
        csvCell(m.meter),
        String(p.t),
        new Date(p.t).toISOString(),
        String(p.v),
      ].join(','));
    }
  }
  return rows.join('\n') + '\n';
}

/** Entrecomilla solo si hace falta, al estilo RFC 4180. */
function csvCell(/** @type {string} */ value) {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Nombre base del archivo descargado: `tokenyou-2026-11-06`. */
export function fileStem(/** @type {number} */ now = Date.now()) {
  return `tokenyou-${new Date(now).toISOString().slice(0, 10)}`;
}

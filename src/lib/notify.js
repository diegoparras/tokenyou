// @ts-check
// Notificaciones de reset, de umbral y de proyección. La detección corre en el
// background tras cada refresh, comparando el snapshot nuevo con el anterior.
//
// - Reset: un medidor que estaba alto cae de golpe → "tu límite se reinició".
// - Umbral: un medidor cruza hacia arriba el nivel elegido → "llegaste al X%".
// - Proyección: al ritmo actual, el medidor se agota antes de reiniciarse.
//
// Las dos primeras son transiciones, así que no se repiten mientras el % no
// vuelva a cruzar. La tercera no tiene una transición natural —la proyección
// sigue siendo cierta en cada refresh—, así que se recuerda la ventana en la
// que ya se avisó y no se repite hasta que esa ventana se reinicie.

import { exhaustionWarning } from './forecast.js';
import { getSeries } from './history.js';

const NOTIFY_KEY = 'prefs.notify';
const SEEN_KEY = 'notify.forecastSeen';

/**
 * @typedef {Object} NotifyPrefs
 * @property {boolean} reset       Avisar cuando un límite se reinicia.
 * @property {number|null} threshold  Nivel de umbral (p. ej. 85) o null si está apagado.
 * @property {boolean} forecast    Avisar cuando la proyección agota la ventana.
 */

/** @returns {Promise<NotifyPrefs>} */
export async function getNotifyPrefs() {
  const stored = await chrome.storage.local.get(NOTIFY_KEY);
  const p = stored[NOTIFY_KEY];
  return {
    reset: typeof p?.reset === 'boolean' ? p.reset : false,
    threshold: typeof p?.threshold === 'number' ? p.threshold : null,
    forecast: typeof p?.forecast === 'boolean' ? p.forecast : false,
  };
}

/** @param {NotifyPrefs} prefs */
export async function setNotifyPrefs(prefs) {
  await chrome.storage.local.set({ [NOTIFY_KEY]: prefs });
}

/**
 * Compara dos snapshots y dispara notificaciones según las prefs.
 * @param {{id:string, name:string}} adapter
 * @param {import('./quota.js').Snapshot|undefined} prev
 * @param {import('./quota.js').Snapshot} next
 */
export async function maybeNotify(adapter, prev, next) {
  if (!next?.ok) return;
  const granted = await chrome.permissions.contains({ permissions: ['notifications'] });
  if (!granted) return;
  const prefs = await getNotifyPrefs();
  if (!prefs.reset && prefs.threshold === null && !prefs.forecast) return;

  // La proyección se calcula sobre el historial, no comparando snapshots, así
  // que no necesita el anterior: funciona incluso si el refresh previo falló.
  if (prefs.forecast) await maybeForecast(adapter, next);

  if (!prev?.ok) return; // reset y umbral sí son transiciones: sin previo no hay nada que comparar
  const before = new Map(prev.meters.map((m) => [m.id, m]));
  for (const m of next.meters) {
    if (typeof m.usedPct !== 'number') continue;
    const p = before.get(m.id);
    if (!p || typeof p.usedPct !== 'number') continue;

    // Reset: estaba consumido y cayó fuerte.
    if (prefs.reset && p.usedPct >= 50 && m.usedPct <= p.usedPct - 40) {
      fire(`reset:${adapter.id}:${m.id}`, adapter.name,
        chrome.i18n.getMessage('notifReset', [adapter.name]) || `${adapter.name}: límite reiniciado`);
      continue;
    }
    // Umbral: cruce hacia arriba.
    if (prefs.threshold !== null && p.usedPct < prefs.threshold && m.usedPct >= prefs.threshold) {
      fire(`th:${adapter.id}:${m.id}`, adapter.name,
        chrome.i18n.getMessage('notifThreshold', [adapter.name, m.label, String(prefs.threshold)]) ||
          `${adapter.name} · ${m.label}: ${prefs.threshold}%`);
    }
  }
}

/**
 * Aviso de proyección: al ritmo actual el medidor se agota antes de reiniciarse.
 *
 * Un aviso por ventana y por medidor. La ventana se identifica por su `resetsAt`,
 * así que cuando el límite se reinicia la próxima proyección vuelve a avisar,
 * pero mientras siga siendo la misma ventana no repite.
 *
 * @param {{id:string, name:string}} adapter
 * @param {import('./quota.js').Snapshot} next
 */
async function maybeForecast(adapter, next) {
  const candidates = next.meters.filter(
    (m) => typeof m.usedPct === 'number' && !!m.resetsAt,
  );
  if (!candidates.length) return;

  const now = Date.now();
  const series = await getSeries(candidates.map((m) => `${adapter.id}/${m.id}`));
  const stored = await chrome.storage.local.get(SEEN_KEY);
  const seen = stored[SEEN_KEY] && typeof stored[SEEN_KEY] === 'object' ? stored[SEEN_KEY] : {};

  let changed = false;
  for (const m of candidates) {
    const key = `${adapter.id}/${m.id}`;
    const w = exhaustionWarning(series[key] ?? [], {
      usedPct: /** @type {number} */ (m.usedPct),
      resetsAt: m.resetsAt,
      now,
    });
    if (!w || !w.exhaustsAt) continue;
    if (seen[key] === m.resetsAt) continue; // ya avisamos para esta ventana

    seen[key] = m.resetsAt;
    changed = true;
    fire(`fc:${adapter.id}:${m.id}`, adapter.name,
      chrome.i18n.getMessage('notifForecast', [adapter.name, m.label, whenText(w.exhaustsAt)]) ||
        `${adapter.name} · ${m.label}: se agota antes del reinicio`);
  }

  // Las ventanas ya vencidas no vuelven: sacarlas evita que el registro crezca.
  for (const [k, v] of Object.entries(seen)) {
    if (typeof v !== 'number' || v < now) { delete seen[k]; changed = true; }
  }
  if (changed) await chrome.storage.local.set({ [SEEN_KEY]: seen });
}

/** Momento legible y corto: día de la semana y hora, en el idioma del navegador. */
function whenText(/** @type {number} */ ms) {
  const lang = chrome.i18n.getUILanguage?.() || 'es';
  try {
    return new Date(ms).toLocaleString(lang, {
      weekday: 'short', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return new Date(ms).toISOString().slice(11, 16);
  }
}

/** @param {string} id @param {string} _platform @param {string} message */
function fire(id, _platform, message) {
  chrome.notifications.create(id, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title: 'TokenYou',
    message,
    silent: false,
  });
}

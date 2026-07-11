// @ts-check
// Notificaciones de reset y de umbral. La detección corre en el background
// tras cada refresh, comparando el snapshot nuevo con el anterior.
//
// - Reset: un medidor que estaba alto cae de golpe → "tu límite se reinició".
// - Umbral: un medidor cruza hacia arriba el nivel elegido → "llegaste al X%".
// Ambas son transiciones, así que no se repiten mientras el % no vuelva a cruzar.

const NOTIFY_KEY = 'prefs.notify';

/**
 * @typedef {Object} NotifyPrefs
 * @property {boolean} reset       Avisar cuando un límite se reinicia.
 * @property {number|null} threshold  Nivel de umbral (p. ej. 85) o null si está apagado.
 */

/** @returns {Promise<NotifyPrefs>} */
export async function getNotifyPrefs() {
  const stored = await chrome.storage.local.get(NOTIFY_KEY);
  const p = stored[NOTIFY_KEY];
  return {
    reset: typeof p?.reset === 'boolean' ? p.reset : false,
    threshold: typeof p?.threshold === 'number' ? p.threshold : null,
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
  if (!next?.ok || !prev?.ok) return;
  const granted = await chrome.permissions.contains({ permissions: ['notifications'] });
  if (!granted) return;
  const prefs = await getNotifyPrefs();
  if (!prefs.reset && prefs.threshold === null) return;

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

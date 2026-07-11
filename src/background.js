// @ts-check
import { getAllAdapters } from './adapters/index.js';
import { worstPct } from './lib/quota.js';
import { getHiddenMeters, getPins, getRefreshMinutes, refreshMinutesFor } from './lib/prefs.js';
import { recordSnapshot } from './lib/history.js';
import { maybeNotify } from './lib/notify.js';

const ALARM_PREFIX = 'tyr:'; // un alarm por plataforma: `tyr:${platformId}`

chrome.runtime.onInstalled.addListener(() => { void syncAlarms(); });
chrome.runtime.onStartup.addListener(() => { void syncAlarms(); });

chrome.permissions.onAdded.addListener(() => { void syncAlarms(); void refreshAll(); });
chrome.permissions.onRemoved.addListener(() => { void syncAlarms(); void pruneRevoked(); });

// Reaccionar a cambios de configuración desde la página de opciones.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes['prefs.refreshMinutes']) void syncAlarms();
  if (changes['prefs.pins'] || changes['prefs.hiddenMeters']) void updateBadge();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name.startsWith(ALARM_PREFIX)) void refreshPlatform(alarm.name.slice(ALARM_PREFIX.length));
});

// Click en una notificación → abrir la plataforma correspondiente.
// El namespace solo existe si el permiso opcional fue concedido.
if (chrome.notifications?.onClicked) {
  chrome.notifications.onClicked.addListener(async (id) => {
    const pid = id.split(':')[1];
    const adapters = await getAllAdapters();
    const a = adapters.find((x) => x.id === pid);
    if (a) await chrome.tabs.create({ url: a.home });
    chrome.notifications.clear(id);
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'refresh') {
    refreshAll().then(() => sendResponse({ ok: true }));
    return true;
  }
});

/** Adaptadores (nativos + personalizados) cuyo host permission fue concedido. */
async function enabledAdapters() {
  const [granted, adapters] = await Promise.all([chrome.permissions.getAll(), getAllAdapters()]);
  const origins = granted.origins ?? [];
  return adapters.filter((a) => origins.includes(a.origin));
}

/**
 * Un alarm por plataforma activa, con su frecuencia (1/5/10 min). En reposo la
 * extensión duerme; el service worker despierta solo cuando una alarm dispara.
 */
async function syncAlarms() {
  const [enabled, refresh, existing] = await Promise.all([
    enabledAdapters(),
    getRefreshMinutes(),
    chrome.alarms.getAll(),
  ]);
  // Limpiar alarms de plataformas que ya no están activas o cambiaron de período.
  for (const a of existing) if (a.name.startsWith(ALARM_PREFIX)) await chrome.alarms.clear(a.name);

  if (!enabled.length) {
    await chrome.action.setBadgeText({ text: '' });
    return;
  }
  for (const adapter of enabled) {
    const minutes = refreshMinutesFor(refresh, adapter.id);
    chrome.alarms.create(ALARM_PREFIX + adapter.id, { periodInMinutes: minutes, delayInMinutes: 0.1 });
  }
}

async function refreshAll() {
  const enabled = await enabledAdapters();
  await Promise.all(enabled.map(refreshOne));
  await updateBadge();
}

/** Refresca una sola plataforma (disparado por su alarm). @param {string} id */
async function refreshPlatform(id) {
  const enabled = await enabledAdapters();
  const adapter = enabled.find((a) => a.id === id);
  if (!adapter) return;
  await refreshOne(adapter);
  await updateBadge();
}

/** @param {import('./adapters/index.js').Adapter} adapter */
async function refreshOne(adapter) {
  /** @type {import('./lib/quota.js').Snapshot} */
  let snap;
  try {
    snap = await adapter.fetchSnapshot();
  } catch (e) {
    const name = e instanceof Error ? e.name : '';
    snap = {
      platformId: adapter.id,
      ok: false,
      error: name === 'AuthError' ? 'auth'
        : name === 'HttpError' ? 'http'
        : name === 'ParseError' ? 'parse'
        : 'network',
      meters: [],
      fetchedAt: Date.now(),
    };
  }
  const before = await chrome.storage.local.get(`snap.${adapter.id}`);
  await chrome.storage.local.set({ [`snap.${adapter.id}`]: snap });
  await recordSnapshot(snap);
  await maybeNotify(adapter, before[`snap.${adapter.id}`], snap);
}

/** Borra snapshots de plataformas cuyo permiso se revocó. */
async function pruneRevoked() {
  const [granted, adapters] = await Promise.all([chrome.permissions.getAll(), getAllAdapters()]);
  const origins = granted.origins ?? [];
  const stale = adapters
    .filter((a) => !origins.includes(a.origin))
    .map((a) => `snap.${a.id}`);
  if (stale.length) await chrome.storage.local.remove(stale);
  await updateBadge();
}

async function updateBadge() {
  const enabled = await enabledAdapters();
  const keys = enabled.map((a) => `snap.${a.id}`);
  const [stored, hidden, pins] = await Promise.all([
    chrome.storage.local.get(keys),
    getHiddenMeters(),
    getPins(),
  ]);
  // El badge sigue el medidor fijado #1; si no hay pins, el peor de todos.
  let worst = null;
  if (pins.length) {
    const [pid, mid] = pins[0].split('/');
    const snap = stored[`snap.${pid}`];
    const m = snap?.ok ? snap.meters.find((/** @type {any} */ x) => x.id === mid) : null;
    if (m && typeof m.usedPct === 'number') worst = Math.round(m.usedPct);
  } else {
    worst = worstPct(Object.values(stored), hidden);
  }

  if (worst === null) {
    await chrome.action.setBadgeText({ text: '' });
    return;
  }
  const color = worst >= 85 ? '#B91C1C' : worst >= 60 ? '#B45309' : '#0F766E';
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeTextColor({ color: '#FFFFFF' });
  await chrome.action.setBadgeText({ text: `${worst}` });
}

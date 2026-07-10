// @ts-check
import { adapters } from './adapters/index.js';
import { worstPct } from './lib/quota.js';

const ALARM = 'tokenyou-refresh';
const REFRESH_MINUTES = 5;

chrome.runtime.onInstalled.addListener(() => { void syncAlarm(); void syncContentScripts(); });
chrome.runtime.onStartup.addListener(() => { void syncAlarm(); void syncContentScripts(); });

chrome.permissions.onAdded.addListener(() => { void syncAlarm(); void syncContentScripts(); void refreshAll(); });
chrome.permissions.onRemoved.addListener(() => { void syncAlarm(); void syncContentScripts(); void pruneRevoked(); });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) void refreshAll();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'refresh') {
    refreshAll().then(() => sendResponse({ ok: true }));
    return true;
  }
});

/** Adaptadores cuyo host permission fue concedido por el usuario. */
async function enabledAdapters() {
  const granted = await chrome.permissions.getAll();
  const origins = granted.origins ?? [];
  return adapters.filter((a) => origins.includes(a.origin));
}

/** El alarm solo existe si hay algo que refrescar: en reposo la extensión duerme. */
async function syncAlarm() {
  const enabled = await enabledAdapters();
  if (enabled.length) {
    chrome.alarms.create(ALARM, { periodInMinutes: REFRESH_MINUTES });
  } else {
    await chrome.alarms.clear(ALARM);
    await chrome.action.setBadgeText({ text: '' });
  }
}

/**
 * Registra los content scripts de las plataformas que los declaran (solo si
 * el usuario concedió ese host) y desregistra los de plataformas revocadas.
 */
async function syncContentScripts() {
  // "scripting" es opcional: sin él no hay nada registrado ni registrable.
  const canScript = await chrome.permissions.contains({ permissions: ['scripting'] });
  if (!canScript) return;
  const granted = await chrome.permissions.getAll();
  const origins = granted.origins ?? [];
  const registered = await chrome.scripting.getRegisteredContentScripts();
  const registeredIds = new Set(registered.map((s) => s.id));

  for (const adapter of adapters) {
    const scripts = /** @type {chrome.scripting.RegisteredContentScript[]|undefined} */ (
      /** @type {any} */ (adapter).contentScripts
    );
    if (!scripts) continue;
    const enabled = origins.includes(adapter.origin);
    const toAdd = scripts.filter((s) => enabled && !registeredIds.has(s.id));
    const toRemove = scripts.filter((s) => !enabled && registeredIds.has(s.id)).map((s) => s.id);
    if (toAdd.length) await chrome.scripting.registerContentScripts(toAdd);
    if (toRemove.length) await chrome.scripting.unregisterContentScripts({ ids: toRemove });
  }
}

async function refreshAll() {
  const enabled = await enabledAdapters();
  await Promise.all(enabled.map(refreshOne));
  await updateBadge();
}

/** @param {(typeof adapters)[number]} adapter */
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
  await chrome.storage.local.set({ [`snap.${adapter.id}`]: snap });
}

/** Borra snapshots de plataformas cuyo permiso se revocó. */
async function pruneRevoked() {
  const granted = await chrome.permissions.getAll();
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
  const stored = await chrome.storage.local.get(keys);
  /** @type {import('./lib/quota.js').Snapshot[]} */
  const snaps = Object.values(stored);
  const worst = worstPct(snaps);

  if (worst === null) {
    await chrome.action.setBadgeText({ text: '' });
    return;
  }
  const color = worst >= 85 ? '#B91C1C' : worst >= 60 ? '#B45309' : '#0F766E';
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeTextColor({ color: '#FFFFFF' });
  await chrome.action.setBadgeText({ text: `${worst}` });
}

// @ts-check
import { getAllAdapters } from './adapters/index.js';
import { worstPct } from './lib/quota.js';
import { getHiddenMeters } from './lib/prefs.js';

const ALARM = 'tokenyou-refresh';
const REFRESH_MINUTES = 5;

chrome.runtime.onInstalled.addListener(() => { void syncAlarm(); });
chrome.runtime.onStartup.addListener(() => { void syncAlarm(); });

chrome.permissions.onAdded.addListener(() => { void syncAlarm(); void refreshAll(); });
chrome.permissions.onRemoved.addListener(() => { void syncAlarm(); void pruneRevoked(); });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) void refreshAll();
});

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

async function refreshAll() {
  const enabled = await enabledAdapters();
  await Promise.all(enabled.map(refreshOne));
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
  await chrome.storage.local.set({ [`snap.${adapter.id}`]: snap });
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
  const [stored, hidden] = await Promise.all([chrome.storage.local.get(keys), getHiddenMeters()]);
  /** @type {import('./lib/quota.js').Snapshot[]} */
  const snaps = Object.values(stored);
  const worst = worstPct(snaps, hidden);

  if (worst === null) {
    await chrome.action.setBadgeText({ text: '' });
    return;
  }
  const color = worst >= 85 ? '#B91C1C' : worst >= 60 ? '#B45309' : '#0F766E';
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeTextColor({ color: '#FFFFFF' });
  await chrome.action.setBadgeText({ text: `${worst}` });
}

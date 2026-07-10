// @ts-check
import { adapters } from '../adapters/index.js';

const t = (/** @type {string} */ key, /** @type {string[]|undefined} */ args = undefined) =>
  chrome.i18n.getMessage(key, args) || key;

const $cards = /** @type {HTMLElement} */ (document.getElementById('cards'));
const $empty = /** @type {HTMLElement} */ (document.getElementById('empty'));
const $add = /** @type {HTMLElement} */ (document.getElementById('add'));
const $addList = /** @type {HTMLElement} */ (document.getElementById('add-list'));
const $updated = /** @type {HTMLElement} */ (document.getElementById('updated'));
const $refresh = /** @type {HTMLButtonElement} */ (document.getElementById('refresh'));

init();

async function init() {
  setText('empty-title', t('emptyTitle'));
  setText('empty-body', t('emptyBody'));
  setText('add-title', t('addPlatform'));
  setText('add-hint', t('addPlatformHint'));
  setText('footer-note', t('footerNote'));
  $refresh.title = t('refresh');

  $refresh.addEventListener('click', () => void requestRefresh());
  chrome.storage.onChanged.addListener((_changes, area) => {
    if (area === 'local') void render();
  });
  setInterval(() => void render(), 30_000);

  await render();
  await requestRefresh();
}

async function requestRefresh() {
  $refresh.classList.add('spinning');
  try {
    await chrome.runtime.sendMessage({ type: 'refresh' });
  } finally {
    $refresh.classList.remove('spinning');
  }
}

async function render() {
  const granted = await chrome.permissions.getAll();
  const origins = granted.origins ?? [];
  const enabled = adapters.filter((a) => origins.includes(a.origin));
  const disabled = adapters.filter((a) => !origins.includes(a.origin));

  const keys = enabled.map((a) => `snap.${a.id}`);
  const stored = await chrome.storage.local.get(keys);

  $cards.replaceChildren(...enabled.map((a) => card(a, stored[`snap.${a.id}`])));
  $empty.hidden = enabled.length > 0;

  $add.hidden = disabled.length === 0;
  $addList.replaceChildren(...disabled.map(addRow));

  const newest = Object.values(stored)
    .map((s) => s?.fetchedAt ?? 0)
    .reduce((a, b) => Math.max(a, b), 0);
  $updated.textContent = newest ? agoLabel(newest) : '';
}

/**
 * @param {(typeof adapters)[number]} adapter
 * @param {import('../lib/quota.js').Snapshot=} snap
 */
function card(adapter, snap) {
  const art = el('article', 'card');

  const head = el('div', 'card-head');
  head.append(el('span', 'pname', adapter.name));
  if (snap?.plan) head.append(el('span', 'chip', snap.plan));
  if (snap?.approx) head.append(el('span', 'chip', t('approxChip')));
  head.append(el('span', 'spacer'));
  const remove = /** @type {HTMLButtonElement} */ (el('button', 'remove-btn', t('remove')));
  remove.addEventListener('click', () => void removePlatform(adapter));
  head.append(remove);
  art.append(head);

  if (!snap) {
    art.append(el('p', 'notice', '…'));
    return art;
  }
  if (!snap.ok) {
    const msg = snap.error === 'auth' ? t('loggedOut', [adapter.name]) : t('fetchError');
    art.append(el('p', 'notice', msg));
    return art;
  }

  for (const m of snap.meters) art.append(meterEl(m));
  return art;
}

/** @param {import('../lib/quota.js').Meter} m */
function meterEl(m) {
  const box = el('div', 'meter');

  const row = el('div', 'm-row');
  row.append(el('span', 'm-label', m.label));
  const val =
    m.usedPct !== null && m.usedPct !== undefined
      ? `${m.usedPct}%`
      : m.total != null && m.remaining != null
        ? t('remainingOf', [String(m.remaining), String(m.total)])
        : m.used != null
          ? t('sentCount', [String(m.used)])
          : t('remainingOnly', [String(m.remaining ?? '—')]);
  row.append(el('span', 'm-val', val));
  box.append(row);

  if (m.usedPct !== null && m.usedPct !== undefined) {
    const track = el('div', 'track');
    const fill = el('div', 'fill' + (m.usedPct >= 85 ? ' crit' : m.usedPct >= 60 ? ' warn' : ''));
    fill.style.width = `${Math.min(100, m.usedPct)}%`;
    track.append(fill);
    box.append(track);
  }

  if (m.resetsAt && m.resetsAt > Date.now()) {
    box.append(el('div', 'm-reset', t('resetsIn', [durationLabel(m.resetsAt - Date.now())])));
  }
  return box;
}

/** @param {(typeof adapters)[number]} adapter */
function addRow(adapter) {
  const row = el('div', 'add-row');
  const left = el('div', '');
  left.append(el('span', 'name', adapter.name));
  left.append(el('span', 'host', adapter.origin.replace(/^https:\/\/|\/\*$/g, '')));
  row.append(left);

  const btn = /** @type {HTMLButtonElement} */ (el('button', 'enable-btn', t('enable')));
  btn.addEventListener('click', async () => {
    const ok = await chrome.permissions.request({ origins: [adapter.origin] });
    if (ok) {
      await render();
      await requestRefresh();
    }
  });
  row.append(btn);
  return row;
}

/** @param {(typeof adapters)[number]} adapter */
async function removePlatform(adapter) {
  await chrome.permissions.remove({ origins: [adapter.origin] });
  await chrome.storage.local.remove(`snap.${adapter.id}`);
  await render();
}

/** @param {number} ms */
function durationLabel(ms) {
  const totalMin = Math.max(1, Math.round(ms / 60_000));
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const min = totalMin % 60;
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h ${String(min).padStart(2, '0')} m`;
  return `${min} m`;
}

/** @param {number} ts */
function agoLabel(ts) {
  const min = Math.round((Date.now() - ts) / 60_000);
  if (min < 1) return t('justNow');
  return t('updatedAgo', [min < 60 ? `${min} m` : `${Math.floor(min / 60)} h`]);
}

/**
 * @param {string} tag
 * @param {string} className
 * @param {string|undefined} [text]
 */
function el(tag, className, text = undefined) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return /** @type {HTMLElement} */ (node);
}

/** @param {string} id @param {string} text */
function setText(id, text) {
  const node = document.getElementById(id);
  if (node) node.textContent = text;
}

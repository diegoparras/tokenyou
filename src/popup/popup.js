// @ts-check
import { getAllAdapters } from '../adapters/index.js';
import { worstPct } from '../lib/quota.js';
import { getHiddenMeters, toggleHiddenMeter } from '../lib/prefs.js';

/** Color de identidad por plataforma (punto de la card). */
const PLATFORM_COLORS = {
  claude: '#D97757',
  chatgpt: '#10A37F',
  gemini: '#4E8CF9',
  grok: '#8A93A6',
  perplexity: '#26B8CE',
};

const t = (/** @type {string} */ key, /** @type {string[]|undefined} */ args = undefined) =>
  chrome.i18n.getMessage(key, args) || key;

const $cards = /** @type {HTMLElement} */ (document.getElementById('cards'));
const $empty = /** @type {HTMLElement} */ (document.getElementById('empty'));
const $add = /** @type {HTMLElement} */ (document.getElementById('add'));
const $addList = /** @type {HTMLElement} */ (document.getElementById('add-list'));
const $updated = /** @type {HTMLElement} */ (document.getElementById('updated'));
const $refresh = /** @type {HTMLButtonElement} */ (document.getElementById('refresh'));
const $customLink = /** @type {HTMLAnchorElement} */ (document.getElementById('custom-link'));

/** Plataformas con el panel "mostrar/ocultar medidores" abierto. @type {Set<string>} */
const editing = new Set();

init();

async function init() {
  setText('empty-title', t('emptyTitle'));
  setText('empty-body', t('emptyBody'));
  setText('add-title', t('addPlatform'));
  setText('add-hint', t('addPlatformHint'));
  setText('footer-note', t('footerNote'));
  $refresh.title = t('refresh');
  $customLink.textContent = t('customLink');
  $customLink.addEventListener('click', (e) => {
    e.preventDefault();
    void chrome.runtime.openOptionsPage();
  });

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
  const [granted, adapters, hidden] = await Promise.all([
    chrome.permissions.getAll(),
    getAllAdapters(),
    getHiddenMeters(),
  ]);
  const origins = granted.origins ?? [];
  const enabled = adapters.filter((a) => origins.includes(a.origin));
  const disabled = adapters.filter((a) => !origins.includes(a.origin));

  const keys = enabled.map((a) => `snap.${a.id}`);
  const stored = await chrome.storage.local.get(keys);

  $cards.replaceChildren(...enabled.map((a) => card(a, stored[`snap.${a.id}`], hidden)));
  $empty.hidden = enabled.length > 0;

  $add.hidden = disabled.length === 0;
  $addList.replaceChildren(...disabled.map(addRow));

  const newest = Object.values(stored)
    .map((s) => s?.fetchedAt ?? 0)
    .reduce((a, b) => Math.max(a, b), 0);
  $updated.textContent = newest ? agoLabel(newest) : '';

  renderOverall(worstPct(Object.values(stored), hidden));
}

/** Anillo de estado global en el header: el peor medidor visible. @param {number|null} worst */
function renderOverall(worst) {
  const svg = /** @type {SVGElement} */ (/** @type {unknown} */ (document.getElementById('overall')));
  const arc = /** @type {SVGCircleElement} */ (/** @type {unknown} */ (document.getElementById('overall-arc')));
  const text = /** @type {SVGTextElement} */ (/** @type {unknown} */ (document.getElementById('overall-text')));
  if (!svg || !arc || !text) return;
  if (worst === null) {
    svg.setAttribute('hidden', '');
    return;
  }
  svg.removeAttribute('hidden');
  const C = 2 * Math.PI * 15;
  arc.style.strokeDasharray = `${(Math.min(100, worst) / 100) * C} ${C}`;
  const cls = worst >= 85 ? 'crit' : worst >= 60 ? 'warn' : 'ok';
  svg.setAttribute('data-level', cls);
  text.textContent = `${worst}`;
}

/**
 * @param {import('../adapters/index.js').Adapter} adapter
 * @param {import('../lib/quota.js').Snapshot|undefined} snap
 * @param {Set<string>} hidden
 */
function card(adapter, snap, hidden) {
  const art = el('article', 'card');
  const isEditing = editing.has(adapter.id);
  const color = PLATFORM_COLORS[/** @type {keyof typeof PLATFORM_COLORS} */ (adapter.id)] ?? '#7B8A96';
  art.style.setProperty('--pcolor', color);

  const head = el('div', 'card-head');
  head.append(el('span', 'pdot'));
  head.append(el('span', 'pname', adapter.name));
  if (snap?.plan) head.append(el('span', 'chip', snap.plan));
  if (snap?.approx) head.append(el('span', 'chip', t('approxChip')));
  head.append(el('span', 'spacer'));

  if (snap?.ok && snap.meters.length) {
    const gear = iconBtn('gear', t('editMeters'));
    if (isEditing) gear.classList.add('active');
    gear.addEventListener('click', () => {
      if (isEditing) editing.delete(adapter.id);
      else editing.add(adapter.id);
      void render();
    });
    head.append(gear);
  }
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

  for (const m of snap.meters) {
    const key = `${snap.platformId}/${m.id}`;
    const isHidden = hidden.has(key);
    if (isHidden && !isEditing) continue;
    art.append(meterEl(m, { key, isHidden, isEditing }));
  }
  return art;
}

/**
 * @param {import('../lib/quota.js').Meter} m
 * @param {{key: string, isHidden: boolean, isEditing: boolean}} opts
 */
function meterEl(m, opts) {
  const box = el('div', 'meter' + (opts.isHidden ? ' meter-hidden' : ''));

  const row = el('div', 'm-row');
  const labelWrap = el('span', 'm-label-wrap');
  if (opts.isEditing) {
    const eye = iconBtn(opts.isHidden ? 'eye-off' : 'eye', t('toggleMeter'));
    eye.classList.add('eye-btn');
    eye.addEventListener('click', async () => {
      await toggleHiddenMeter(opts.key);
      await chrome.runtime.sendMessage({ type: 'refresh' });
    });
    labelWrap.append(eye);
  }
  labelWrap.append(el('span', 'm-label', m.label));
  row.append(labelWrap);

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

  const notes = [];
  if (m.detail) notes.push(m.detail);
  if (m.resetsAt && m.resetsAt > Date.now()) {
    notes.push(t('resetsIn', [durationLabel(m.resetsAt - Date.now())]));
  }
  if (notes.length) box.append(el('div', 'm-reset', notes.join(' · ')));
  return box;
}

/** @param {import('../adapters/index.js').Adapter} adapter */
function addRow(adapter) {
  const row = el('div', 'add-row');
  const left = el('div', 'add-left');
  const nameLine = el('div', 'name-line');
  nameLine.append(el('span', 'name', adapter.name));
  nameLine.append(el('span', 'chip tier-endpoint', t('tierEndpoint')));
  if (adapter.custom) nameLine.append(el('span', 'chip', t('customChip')));
  left.append(nameLine);
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

/** @param {import('../adapters/index.js').Adapter} adapter */
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

const ICONS = {
  gear: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm8.5 4a6.7 6.7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2.1-1.3L15.6 3h-4l-.4 2.6a7 7 0 0 0-2.1 1.3l-2.3-1-2 3.4 2 1.5a6.7 6.7 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2.1 1.3l.4 2.6h4l.4-2.6a7 7 0 0 0 2.1-1.3l2.3 1 2-3.4-2-1.5c.06-.4.1-.8.1-1.2z',
  eye: 'M12 5c-5 0-9 4.5-10 7 1 2.5 5 7 10 7s9-4.5 10-7c-1-2.5-5-7-10-7zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8z',
  'eye-off':
    'M3 4l17 17-1.5 1.5-3-3A11.6 11.6 0 0 1 12 20c-5 0-9-4.5-10-7a13.7 13.7 0 0 1 4.2-5L1.5 5.5 3 4zm9 4a4 4 0 0 1 4 4l-5-5c.3-.06.6-.1 1-.1zM12 5c5 0 9 4.5 10 7a13.9 13.9 0 0 1-2.6 3.7l-2.9-2.9A4 4 0 0 0 12 8c-.4 0-.7 0-1 .1L8.6 5.6C9.7 5.2 10.8 5 12 5z',
};

/** @param {keyof typeof ICONS} name @param {string} title */
function iconBtn(name, title) {
  const btn = /** @type {HTMLButtonElement} */ (el('button', 'icon-btn small'));
  btn.title = title;
  btn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[name]}" fill="currentColor"/></svg>`;
  return btn;
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

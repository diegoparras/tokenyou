// @ts-check
import { getAllAdapters } from '../adapters/index.js';
import { worstPct } from '../lib/quota.js';
import {
  getHiddenMeters, toggleHiddenMeter,
  getHiddenPlatforms, setPlatformHidden, unpinPlatform,
  getPins, togglePin, getCollapsed, toggleCollapsed, getOrder, setOrder, MAX_PINS,
} from '../lib/prefs.js';
import { getSeries } from '../lib/history.js';

const t = (/** @type {string} */ key, /** @type {string[]|undefined} */ args = undefined) =>
  chrome.i18n.getMessage(key, args) || key;

/** Color de identidad por plataforma (el punto que la identifica). */
const PLATFORM_COLORS = {
  claude: '#D97757', chatgpt: '#10A37F', gemini: '#4E8CF9', grok: '#8A93A6',
  perplexity: '#26B8CE', copilot: '#6E40C9', abacus: '#EF6C3A',
};
const pcolor = (/** @type {string} */ id) =>
  PLATFORM_COLORS[/** @type {keyof typeof PLATFORM_COLORS} */ (id)] ?? '#7B8A96';
/** @param {number} pct */
const stateOf = (pct) => (pct >= 85 ? 'crit' : pct >= 60 ? 'warn' : 'ok');

const $cards = /** @type {HTMLElement} */ (document.getElementById('cards'));
const $empty = /** @type {HTMLElement} */ (document.getElementById('empty'));
const $hidden = /** @type {HTMLElement} */ (document.getElementById('hidden'));
const $hiddenList = /** @type {HTMLElement} */ (document.getElementById('hidden-list'));
const $add = /** @type {HTMLElement} */ (document.getElementById('add'));
const $addList = /** @type {HTMLElement} */ (document.getElementById('add-list'));
const $ringGroup = /** @type {HTMLElement} */ (document.getElementById('ring-group'));
const $refresh = /** @type {HTMLButtonElement} */ (document.getElementById('refresh'));
const $history = /** @type {HTMLButtonElement} */ (document.getElementById('history'));
const $customLink = /** @type {HTMLAnchorElement} */ (document.getElementById('custom-link'));

/** Plataformas en modo "elegir medidores" (ojitos visibles). @type {Set<string>} */
const editing = new Set();
/** Plataforma con el menú ⋮ desplegado (una sola a la vez). @type {string|null} */
let menuFor = null;
let firstPaint = true;
let dragId = /** @type {string|null} */ (null);

init();

async function init() {
  setText('empty-title', t('emptyTitle'));
  setText('empty-body', t('emptyBody'));
  setText('add-title', t('addPlatform'));
  setText('add-hint', t('addPlatformHint'));
  setText('footer-note', t('footerNote'));
  $refresh.title = t('refresh');
  $history.title = t('historyOpen');
  $customLink.textContent = t('customLink');
  $customLink.addEventListener('click', (e) => { e.preventDefault(); void chrome.runtime.openOptionsPage(); });
  $history.addEventListener('click', () => {
    const url = chrome.runtime.getURL('src/history/history.html');
    if (chrome.tabs?.create) chrome.tabs.create({ url });
    else window.open(url, '_blank');
  });
  $refresh.addEventListener('click', () => void requestRefresh());

  chrome.storage.onChanged.addListener((_c, area) => { if (area === 'local') void render(); });
  setInterval(() => void render(), 30_000);

  // Cerrar el menú ⋮ al hacer clic fuera de él.
  document.addEventListener('click', (e) => {
    if (menuFor === null) return;
    if (e.target instanceof Element && e.target.closest('.card-menu, .menu-btn')) return;
    menuFor = null;
    void render();
  });

  await render();
  await requestRefresh();
}

async function requestRefresh() {
  $refresh.classList.add('spinning');
  try { await chrome.runtime.sendMessage({ type: 'refresh' }); }
  finally { $refresh.classList.remove('spinning'); }
}

async function render() {
  const [granted, adapters, hidden, hiddenPlatforms, pins, collapsed, order] = await Promise.all([
    chrome.permissions.getAll(), getAllAdapters(),
    getHiddenMeters(), getHiddenPlatforms(), getPins(), getCollapsed(), getOrder(),
  ]);
  const origins = granted.origins ?? [];
  const enabled = adapters.filter((a) => origins.includes(a.origin));
  const disabled = adapters.filter((a) => !origins.includes(a.origin));
  // Con permiso pero escondidas del popup vs. las que se muestran.
  const visible = enabled.filter((a) => !hiddenPlatforms.has(a.id));
  const hiddenEnabled = enabled.filter((a) => hiddenPlatforms.has(a.id));

  const stored = await chrome.storage.local.get(enabled.map((a) => `snap.${a.id}`));

  // Series de historial (sparklines) de los medidores con % visibles.
  const seriesIds = [];
  for (const a of visible) {
    const s = stored[`snap.${a.id}`];
    if (s?.ok) for (const m of s.meters) if (typeof m.usedPct === 'number') seriesIds.push(`${a.id}/${m.id}`);
  }
  const series = await getSeries(seriesIds);

  // Orden: pins primero (por su orden), luego el orden manual, luego el natural.
  const pinnedPids = [...new Set(pins.map((k) => k.split('/')[0]))];
  const sorted = [...visible].sort((a, b) => rank(a, pinnedPids, order) - rank(b, pinnedPids, order));

  const cards = sorted.map((a, i) => {
    const node = card(a, stored[`snap.${a.id}`], { hidden, pins, collapsed, series });
    if (firstPaint) { node.classList.add('enter'); node.style.setProperty('--i', String(i)); }
    return node;
  });
  $cards.replaceChildren(...cards);
  $empty.hidden = enabled.length > 0;

  $hidden.hidden = hiddenEnabled.length === 0;
  setText('hidden-title', t('hiddenTitle'));
  $hiddenList.replaceChildren(...hiddenEnabled.map(hiddenRow));

  $add.hidden = disabled.length === 0;
  $addList.replaceChildren(...disabled.map(addRow));

  renderRings(visible, stored, pins, hidden);
  firstPaint = false;
}

/**
 * @param {import('../adapters/index.js').Adapter} a
 * @param {string[]} pinnedPids
 * @param {string[]} order
 */
function rank(a, pinnedPids, order) {
  if (pinnedPids.includes(a.id)) return -100 + pinnedPids.indexOf(a.id);
  const oi = order.indexOf(a.id);
  return oi >= 0 ? oi : 50;
}

/* ============ HEADER: anillos + etiquetas ============ */
/**
 * @param {import('../adapters/index.js').Adapter[]} enabled
 * @param {Record<string, any>} stored
 * @param {string[]} pins
 * @param {Set<string>} hidden
 */
function renderRings(enabled, stored, pins, hidden) {
  // Datos de cada anillo: los pins (medidor exacto) o el peor global si no hay pins.
  const data = [];
  if (pins.length) {
    for (const key of pins.slice(0, MAX_PINS)) {
      const [pid, mid] = key.split('/');
      const snap = stored[`snap.${pid}`];
      const m = snap?.ok ? snap.meters.find((/** @type {any} */ x) => x.id === mid) : null;
      const adapter = enabled.find((a) => a.id === pid);
      if (m && typeof m.usedPct === 'number' && adapter) {
        data.push({ pct: m.usedPct, color: pcolor(pid), name: adapter.name });
      }
    }
  } else {
    const worst = worstPct(Object.values(stored), hidden);
    if (worst !== null) data.push({ pct: worst, color: null, name: t('worstLabel') });
  }
  if (!data.length) { $ringGroup.replaceChildren(); return; }

  const R = [20, 14, 8];
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 48 48');
  svg.setAttribute('class', 'rings-svg');
  data.slice(0, 3).forEach((d, i) => {
    const r = R[i], circ = 2 * Math.PI * r, len = (Math.min(100, d.pct) / 100) * circ;
    const track = document.createElementNS(NS, 'circle');
    track.setAttribute('cx', '24'); track.setAttribute('cy', '24'); track.setAttribute('r', String(r));
    track.setAttribute('class', 'ring-track');
    const arc = document.createElementNS(NS, 'circle');
    arc.setAttribute('cx', '24'); arc.setAttribute('cy', '24'); arc.setAttribute('r', String(r));
    arc.setAttribute('class', `ring-arc ${stateOf(d.pct)}`);
    arc.setAttribute('transform', 'rotate(-90 24 24)');
    arc.setAttribute('stroke-dasharray', `${len.toFixed(1)} ${circ.toFixed(1)}`);
    svg.append(track, arc);
  });
  const rings = el('span', 'rings');
  rings.append(svg);

  const labels = el('div', 'ring-labels');
  for (const d of data) {
    const row = el('span', 'rl' + (d.color ? '' : ' global'));
    const dot = el('i', '');
    if (d.color) dot.style.background = d.color;
    const name = el('span', 'rn', d.name);
    const val = el('b', 'st-' + stateOf(d.pct), `${d.pct}%`);
    row.append(dot, name, val);
    labels.append(row);
  }
  $ringGroup.replaceChildren(rings, labels);
}

/* ============ CARDS ============ */
/**
 * @param {import('../adapters/index.js').Adapter} adapter
 * @param {import('../lib/quota.js').Snapshot|undefined} snap
 * @param {{hidden:Set<string>, pins:string[], collapsed:Set<string>, series:Record<string,{t:number,v:number}[]>}} ctx
 */
function card(adapter, snap, ctx) {
  const art = el('article', 'card');
  art.dataset.pid = adapter.id;
  art.draggable = true;
  wireDrag(art, adapter.id);

  const meters = snap?.ok ? snap.meters : [];
  const worst = meters.reduce((mx, m) => (typeof m.usedPct === 'number' ? Math.max(mx, m.usedPct) : mx), 0);
  const st = snap?.ok && meters.length ? stateOf(worst) : null;
  if (st) art.classList.add('state-' + st);
  const isPinned = ctx.pins.some((k) => k.startsWith(adapter.id + '/'));
  if (isPinned) art.classList.add('pinned');
  const isCollapsed = ctx.collapsed.has(adapter.id) && !!snap?.ok;
  if (!isCollapsed) art.classList.add('open');
  art.style.setProperty('--pc', pcolor(adapter.id));

  // ---- header de la card ----
  const head = el('div', 'chead');
  const menu = iconBtn('menu', t('cardMenu'));
  menu.classList.add('menu-btn');
  if (menuFor === adapter.id || editing.has(adapter.id)) menu.classList.add('active');
  menu.addEventListener('click', (e) => {
    e.stopPropagation();
    menuFor = menuFor === adapter.id ? null : adapter.id;
    void render();
  });
  head.append(menu);
  head.append(el('span', 'pdot'));
  head.append(el('span', 'pname', adapter.name));
  if (snap?.plan) head.append(el('span', 'chip', snap.plan));
  if (snap?.account && !isCollapsed) head.append(el('span', 'paccount', snap.account));
  head.append(el('span', 'spacer'));

  if (isCollapsed) {
    const track = el('div', 'mini-track');
    const fill = el('div', 'mini-fill st-' + stateOf(worst));
    fill.style.width = `${Math.min(100, worst)}%`;
    track.append(fill);
    head.append(track);
    head.append(el('span', 'mini-val st-' + stateOf(worst), `${Math.round(worst)}%`));
  }
  // chevron (colapsar) solo si hay datos
  if (snap?.ok && meters.length) {
    const chev = iconBtn('chevron', t('collapseCard'));
    chev.classList.add('chev');
    chev.addEventListener('click', async (e) => { e.stopPropagation(); await toggleCollapsed(adapter.id); });
    head.append(chev);
  }
  head.addEventListener('click', (e) => {
    if (e.target instanceof Element && (e.target.closest('.menu-btn') || e.target.closest('.chev'))) return;
    if (snap?.ok && meters.length) void toggleCollapsed(adapter.id);
  });
  art.append(head);

  // Menú ⋮ desplegado (se superpone; disponible aun en estado colapsado o sin sesión).
  if (menuFor === adapter.id) art.append(menuPanel(adapter, !!(snap?.ok && meters.length)));

  if (isCollapsed) return art;

  // ---- cuerpo ----
  if (!snap) { art.append(el('p', 'notice', '…')); return art; }
  if (!snap.ok) {
    art.append(el('p', 'notice', snap.error === 'auth' ? t('loggedOut', [adapter.name]) : t('fetchError')));
    return art;
  }
  const body = el('div', 'cbody');
  const isEditing = editing.has(adapter.id);
  for (const m of snap.meters) {
    const key = `${adapter.id}/${m.id}`;
    const isHidden = ctx.hidden.has(key);
    if (isHidden && !isEditing) continue;
    body.append(meterEl(adapter.id, m, { key, isHidden, isEditing, pinned: ctx.pins.includes(key) }, ctx.series[key]));
  }
  art.append(body);
  return art;
}

/**
 * @param {string} pid
 * @param {import('../lib/quota.js').Meter} m
 * @param {{key:string, isHidden:boolean, isEditing:boolean, pinned:boolean}} opts
 * @param {{t:number,v:number}[]} [points]
 */
function meterEl(pid, m, opts, points) {
  const box = el('div', 'meter' + (opts.isHidden ? ' meter-hidden' : ''));
  const row = el('div', 'm-row');

  // En modo edición: ojito para ocultar. Si no: alfiler para fijar (solo medidores con %).
  if (opts.isEditing) {
    const eye = iconBtn(opts.isHidden ? 'eye-off' : 'eye', t('toggleMeter'));
    eye.classList.add('lead-btn');
    eye.addEventListener('click', async () => { await toggleHiddenMeter(opts.key); await chrome.runtime.sendMessage({ type: 'refresh' }); });
    row.append(eye);
  } else if (typeof m.usedPct === 'number') {
    const pin = iconBtn('pin', t('pinMeter'));
    pin.classList.add('lead-btn', 'pin');
    if (opts.pinned) pin.classList.add('on');
    pin.style.setProperty('--pc', pcolor(pid));
    pin.addEventListener('click', async (e) => { e.stopPropagation(); await togglePin(opts.key); });
    row.append(pin);
  } else {
    row.append(el('span', 'lead-gap'));
  }

  row.append(el('span', 'm-label', m.label));

  if (typeof m.usedPct === 'number' && points && points.length >= 3) {
    row.append(sparkEl(points.map((p) => p.v), stateOf(m.usedPct)));
  }
  const val =
    m.usedPct !== null && m.usedPct !== undefined ? `${m.usedPct}%`
      : m.total != null && m.remaining != null ? t('remainingOf', [String(m.remaining), String(m.total)])
        : m.used != null ? t('sentCount', [String(m.used)])
          : t('remainingOnly', [String(m.remaining ?? '—')]);
  row.append(el('span', 'm-val', val));
  box.append(row);

  if (typeof m.usedPct === 'number') {
    const track = el('div', 'track');
    const fill = el('div', 'fill st-' + stateOf(m.usedPct));
    const target = `${Math.min(100, m.usedPct)}%`;
    if (firstPaint) { fill.style.width = '0%'; requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = target; })); }
    else fill.style.width = target;
    track.append(fill);
    box.append(track);
  }

  const notes = [];
  if (m.detail) notes.push(m.detail);
  if (m.resetsAt && m.resetsAt > Date.now()) notes.push(t('resetsIn', [durationLabel(m.resetsAt - Date.now())]));
  if (notes.length) box.append(el('div', 'm-reset', notes.join(' · ')));
  return box;
}

/* ============ MENÚ ⋮ DE LA CARD ============ */
/**
 * @param {import('../adapters/index.js').Adapter} adapter
 * @param {boolean} canChooseMeters hay medidores para mostrar/ocultar
 */
function menuPanel(adapter, canChooseMeters) {
  const panel = el('div', 'card-menu');
  panel.addEventListener('click', (e) => e.stopPropagation());
  if (canChooseMeters) {
    const isEd = editing.has(adapter.id);
    panel.append(menuItem('sliders', t(isEd ? 'menuDoneMeters' : 'menuChooseMeters'), false, () => chooseMeters(adapter, isEd)));
  }
  panel.append(menuItem('eye-off', t('menuHidePlatform'), false, () => hidePlatform(adapter)));
  panel.append(menuItem('trash', t('menuRemovePlatform'), true, () => removePlatform(adapter)));
  return panel;
}

/**
 * @param {keyof typeof ICONS} iconName @param {string} label
 * @param {boolean} danger @param {() => void|Promise<void>} onClick
 */
function menuItem(iconName, label, danger, onClick) {
  const btn = el('button', 'menu-item' + (danger ? ' danger' : ''));
  btn.innerHTML = `<svg class="mi-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[iconName]}"/></svg>`;
  btn.append(el('span', 'mi-label', label));
  btn.addEventListener('click', (e) => { e.stopPropagation(); void onClick(); });
  return btn;
}

/** Alterna el modo "elegir medidores" (ojitos). @param {import('../adapters/index.js').Adapter} adapter @param {boolean} isEditing */
async function chooseMeters(adapter, isEditing) {
  menuFor = null;
  if (isEditing) { editing.delete(adapter.id); await render(); return; }
  const collapsed = await getCollapsed();
  if (collapsed.has(adapter.id)) await toggleCollapsed(adapter.id); // expandir para ver los ojitos
  editing.add(adapter.id);
  await render();
}

/** Esconde la plataforma del popup (mantiene permiso; se sigue midiendo). @param {import('../adapters/index.js').Adapter} adapter */
async function hidePlatform(adapter) {
  menuFor = null;
  editing.delete(adapter.id);
  await unpinPlatform(adapter.id);
  await setPlatformHidden(adapter.id, true);
  await render();
}

/** Quita la plataforma revocando su permiso de host. @param {import('../adapters/index.js').Adapter} adapter */
async function removePlatform(adapter) {
  menuFor = null;
  editing.delete(adapter.id);
  await unpinPlatform(adapter.id);
  await setPlatformHidden(adapter.id, false);
  await chrome.permissions.remove({ origins: [adapter.origin] });
  await render();
}

/* ============ ADD / DRAG / HELPERS ============ */
/** Fila de una plataforma oculta (con permiso), con botón "Mostrar". @param {import('../adapters/index.js').Adapter} adapter */
function hiddenRow(adapter) {
  const row = el('div', 'add-row');
  const left = el('div', 'add-left');
  const nameLine = el('div', 'name-line');
  nameLine.append(el('span', 'name', adapter.name));
  left.append(nameLine);
  left.append(el('span', 'host', adapter.origin.replace(/^https:\/\/|\/\*$/g, '')));
  row.append(left);
  const btn = /** @type {HTMLButtonElement} */ (el('button', 'enable-btn', t('showPlatform')));
  btn.addEventListener('click', async () => { await setPlatformHidden(adapter.id, false); await render(); });
  row.append(btn);
  return row;
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
    if (ok) { await render(); await requestRefresh(); }
  });
  row.append(btn);
  return row;
}

/** @param {HTMLElement} art @param {string} pid */
function wireDrag(art, pid) {
  art.addEventListener('dragstart', () => { dragId = pid; art.classList.add('drag'); });
  art.addEventListener('dragend', () => { dragId = null; art.classList.remove('drag'); document.querySelectorAll('.card.over').forEach((x) => x.classList.remove('over')); });
  art.addEventListener('dragover', (e) => { e.preventDefault(); art.classList.add('over'); });
  art.addEventListener('dragleave', () => art.classList.remove('over'));
  art.addEventListener('drop', async (e) => {
    e.preventDefault();
    if (!dragId || dragId === pid) return;
    const ids = [...$cards.querySelectorAll('.card')].map((c) => /** @type {HTMLElement} */ (c).dataset.pid || '');
    const from = ids.indexOf(dragId), to = ids.indexOf(pid);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    await setOrder(ids);
  });
}

/** @param {number} ms */
function durationLabel(ms) {
  const totalMin = Math.max(1, Math.round(ms / 60_000));
  const d = Math.floor(totalMin / 1440), h = Math.floor((totalMin % 1440) / 60), min = totalMin % 60;
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h ${String(min).padStart(2, '0')} m`;
  return `${min} m`;
}

const ICONS = {
  menu: 'M12 5a1.7 1.7 0 1 0 0 3.4A1.7 1.7 0 0 0 12 5zm0 5.3a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4zm0 5.3a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4z',
  chevron: 'M6 9l6 6 6-6',
  pin: 'M12 17v5M9 3h6l-1 7 3 3H7l3-3-1-7z',
  eye: 'M12 5c-5 0-9 4.5-10 7 1 2.5 5 7 10 7s9-4.5 10-7c-1-2.5-5-7-10-7zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8z',
  'eye-off': 'M3 4l17 17-1.5 1.5-3-3A11.6 11.6 0 0 1 12 20c-5 0-9-4.5-10-7a13.7 13.7 0 0 1 4.2-5L1.5 5.5 3 4zm9 4a4 4 0 0 1 4 4l-5-5c.3-.06.6-.1 1-.1zM12 5c5 0 9 4.5 10 7a13.9 13.9 0 0 1-2.6 3.7l-2.9-2.9A4 4 0 0 0 12 8c-.4 0-.7 0-1 .1L8.6 5.6C9.7 5.2 10.8 5 12 5z',
  sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M2 14h4M10 8h4M18 16h4',
  trash: 'M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6',
};
/** @param {keyof typeof ICONS} name @param {string} title */
function iconBtn(name, title) {
  const btn = /** @type {HTMLButtonElement} */ (el('button', 'icon-btn small'));
  btn.title = title;
  const filled = name === 'menu' || name === 'pin' || name === 'eye' || name === 'eye-off';
  btn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[name]}" ${filled ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'}/></svg>`;
  return btn;
}

/** @param {number[]} vals @param {'ok'|'warn'|'crit'} cls */
function sparkEl(vals, cls) {
  const w = 50, h = 15;
  const step = w / (vals.length - 1);
  const pts = vals.map((v, i) => [i * step, h - (Math.max(0, Math.min(100, v)) / 100) * (h - 2) - 1]);
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const area = `${line} L ${w} ${h} L 0 ${h} Z`;
  const end = pts[pts.length - 1];
  const span = el('span', `spark sp-${cls}`);
  span.innerHTML =
    `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">` +
    `<path class="sp-area" d="${area}"/><path class="sp-line" d="${line}" fill="none"/>` +
    `<circle class="sp-dot" cx="${end[0].toFixed(1)}" cy="${end[1].toFixed(1)}" r="1.6"/></svg>`;
  return span;
}

/** @param {string} tag @param {string} className @param {string|undefined} [text] */
function el(tag, className, text = undefined) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return /** @type {HTMLElement} */ (node);
}
/** @param {string} id @param {string} text */
function setText(id, text) { const n = document.getElementById(id); if (n) n.textContent = text; }
